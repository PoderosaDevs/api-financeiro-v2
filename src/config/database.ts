import 'dotenv/config';
import { Sequelize } from 'sequelize-typescript';
import { User, Batch, Marketplace, Store, Sale, Payment } from '../models/index'; // 👈 Importando tudo do arquivo único

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('A variável ambiente DATABASE_URL não foi definida no arquivo .env');
}

export const sequelize = new Sequelize(connectionString, {
  dialect: 'postgres',
  logging: false, 
  models: [User, Batch, Marketplace, Store, Sale, Payment], 
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