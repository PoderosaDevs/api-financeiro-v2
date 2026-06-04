import express from 'express';
import cors from 'cors';
import { connectDatabase } from './config/database'; // 👈 Importa a conexão
import { routes } from './routes';

const app = express();

app.use(cors());

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

app.use(routes);

const PORT = 3000;

// Aguarda conectar ao banco antes de abrir a porta HTTP
connectDatabase().then(() => {
  app.use(routes);
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando sem Prisma em http://localhost:${PORT}`);
  });
});