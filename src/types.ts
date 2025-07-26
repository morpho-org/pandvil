export interface Chain {
  chainId: number;
  rpcUrl: string;
  blockNumber: number;
}

export interface InstanceStatusResponse {
  id: string;
  rpcUrls: Record<number, { rpcUrl: string }>;
  apiUrl: string;
  status: "starting" | "ready" | "stopping";
}
