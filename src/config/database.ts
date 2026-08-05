import 'dotenv/config';
import { Sequelize } from 'sequelize-typescript';
import { User, Batch, Marketplace, Store, Sale, Payment,Devolution, Frete, Difal } from '../models/index'; // 👈 Importando tudo do arquivo único

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('A variável ambiente DATABASE_URL não foi definida no arquivo .env');
}

export const sequelize = new Sequelize(connectionString, {
  dialect: 'postgres',
  logging: false,
  models: [User, Batch, Marketplace, Store, Sale, Payment, Devolution, Frete, Difal],

  // Resiliência de conexão: sem isso, qualquer soquete que caia (comum em bancos
  // remotos gerenciados, ex. Render) derruba a query/transação na hora com
  // "Client has encountered a connection error and is not queryable" e não tenta
  // de novo. "pool" evita acumular conexões ociosas por tempo demais, e "retry"
  // faz o Sequelize tentar novamente automaticamente quando o erro for claramente
  // de conexão (não mexe em nada de validação de dados/regra de negócio).
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  retry: {
    max: 3,
    match: [
      /ConnectionError/,
      /ConnectionRefusedError/,
      /ConnectionTimedOutError/,
      /TimeoutError/,
      /Connection terminated/,
      /ECONNRESET/,
      /Client has encountered a connection error and is not queryable/,
    ],
  },
});

export async function connectDatabase() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true }); // Sincroniza e cria as tabelas se não existirem
    console.log('✅ Conexão com o PostgreSQL via Sequelize estabelecida com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao conectar ao banco de dados:', error);
    process.exit(1);
  }
}