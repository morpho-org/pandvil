import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

export class Database {
  public readonly connectionString: string;
  private db: ReturnType<typeof drizzle>;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.db = drizzle(connectionString);
  }

  close(): Promise<void> {
    return this.db.$client.end();
  }

  async dropSchema(schema: string) {
    await this.db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  }

  /** Fetches the highest block number per chain_id from ponder_sync.blocks. */
  async getLatestBlockNumbers() {
    try {
      const rows = await this.db.execute(sql`
        SELECT
          chain_id,
          MAX(number) AS block_number
        FROM ponder_sync.blocks
        GROUP BY chain_id
      `);

      return rows.rows.map(({ chain_id, block_number }) => ({
        chainId: Number(chain_id as string),
        blockNumber: Number(block_number as string),
      }));
    } catch (e) {
      console.error("Failed to get latest block numbers from database", e);
      return [];
    }
  }

  /** Updates ponder_sync.intervals so that a given block number is "latest" for each chain. */
  async updateBlockNumberIntervals(
    blockNumbers: { chainId: number; blockNumber: number }[],
  ): Promise<void> {
    for (const { chainId, blockNumber } of blockNumbers) {
      await this.db.execute(
        sql.raw(`
          UPDATE ponder_sync.intervals 
          SET blocks = blocks * '{(-infinity,${blockNumber}]}'::nummultirange  
          WHERE chain_id = ${chainId}
        `),
      );
    }
  }
}
