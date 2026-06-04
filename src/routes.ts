import { Router } from 'express';
import { AuthController } from './controllers/AuthController';
import { ImportSalesController } from './controllers/ImportSalesController';
import { authMiddleware } from './middlewares/auth';
import { MarketplaceController } from './controllers/MarketplaceController';
import { SaleController } from './controllers/SaleController'; 
import { ImportPaymentsController } from './controllers/ImportPaymentsController';
import { StoreController } from './controllers/StoreController';
import { BatchController } from './controllers/BatchController'; // 👈 Novo Controller Importado

const routes = Router();
const authController = new AuthController();
const importSalesController = new ImportSalesController();
const paymentsController = new ImportPaymentsController();
const marketplaceController = new MarketplaceController(); 
const saleController = new SaleController();               
const storeController = new StoreController();
const batchController = new BatchController(); // 👈 Instanciado aqui

// Rotas públicas (não precisam de token)
routes.post('/register', authController.register);
routes.post('/login', (req, res) => authController.login(req, res));

// Rota protegida (passa pelo middleware primeiro)
routes.get('/profile', authMiddleware, (req, res) => {
  return res.json({ 
    message: 'Você acessou uma rota protegida com sucesso!', 
    seuidNoToken: req.userId 
  });
});

// --- FLUXOS DE IMPORTAÇÃO (Gera os lotes de Vendas ou Pagamentos) ---
routes.post('/sales/import', authMiddleware, importSalesController.importData);   
routes.post('/payments/import', authMiddleware, paymentsController.importData);

// --- 📦 NOVAS ROTAS CENTRALIZADAS E UNIFICADAS DE LOTES (BATCHES) ---
routes.get('/batches', authMiddleware, batchController.list);            // Lista tudo (Venda e Pagamento) com paginação
routes.get('/batches/:id', authMiddleware, batchController.getDetails);  // Detalha o lote por ID
routes.delete('/batches/:id', authMiddleware, batchController.delete);      // Exclui o lote de forma segura

// 🏪 ROTAS DE MARKETPLACE
routes.post('/marketplaces', authMiddleware, marketplaceController.create); 
routes.get('/marketplaces', authMiddleware, marketplaceController.list);
routes.put('/marketplaces/:id', authMiddleware, marketplaceController.update);
routes.delete('/marketplaces/:id', authMiddleware, marketplaceController.delete);

// 💰 ROTAS DE VENDAS
routes.post('/sales', authMiddleware, saleController.create);
routes.get('/sales', authMiddleware, saleController.list);
routes.get('/sales/summary', authMiddleware, saleController.summary); 
routes.get('/sales/:id', authMiddleware, saleController.show);
routes.put('/sales/:id', authMiddleware, saleController.update);
routes.delete('/sales/:id', authMiddleware, saleController.delete);

// 🏬 ROTAS DAS LOJAS
routes.post('/stores', authMiddleware, storeController.create);
routes.get('/stores', authMiddleware, storeController.list);
routes.put('/stores/:id', authMiddleware, storeController.update);
routes.delete('/stores/:id', authMiddleware, storeController.delete);

export { routes };