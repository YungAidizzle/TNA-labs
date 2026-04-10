declare module "node:sqlite" {
  export class StatementSync {
    run(...parameters: unknown[]): {
      changes: number;
      lastInsertRowid: bigint | number;
    };
    get(...parameters: unknown[]): Record<string, unknown> | undefined;
    all(...parameters: unknown[]): Array<Record<string, unknown>>;
  }

  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
