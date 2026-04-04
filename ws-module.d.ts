/** ws package resolves to wrapper.mjs under `moduleResolution: bundler`; provide minimal types for the custom server. */
declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export class WebSocket {
    static readonly OPEN: number;
    readonly readyState: number;
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { noServer?: boolean; server?: import("node:http").Server });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (client: WebSocket, request: IncomingMessage) => void
    ): void;
    on(event: "connection", listener: (socket: WebSocket, request: IncomingMessage) => void): this;
    emit(event: "connection", socket: WebSocket, request: IncomingMessage): boolean;
    emit(event: string, ...args: unknown[]): boolean;
  }
}
