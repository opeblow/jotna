import postgres from "postgres";

export type Sql = postgres.Sql<{}>;
export type Tx = postgres.TransactionSql<{}>;
export type Db = Sql | Tx;

export function createDb(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
}
