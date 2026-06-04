import express from 'express';
import cors from 'cors';
import { connectDatabase } from './config/database'; 
import { routes } from './routes';

const app = express();

// Configuração do CORS permitindo o seu front-end da Vercel
app.use(cors({
  origin: 'https://paraiso-finance.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

const PORT = 3000;

// Aguarda conectar ao banco antes de carregar as rotas e abrir a porta HTTP
connectDatabase().then(() => {
  app.use(routes); // As rotas ficam apenas aqui dentro, garantindo segurança na inicialização
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando sem Prisma em http://localhost:${PORT}`);
  });
});