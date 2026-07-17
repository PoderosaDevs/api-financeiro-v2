import { Router } from 'express';
import { AuthController } from './controllers/AuthController';
import { ImportSalesController } from './controllers/ImportSalesController';
import { authMiddleware } from './middlewares/auth';
import { MarketplaceController } from './controllers/MarketplaceController';
import { SaleController } from './controllers/SaleController'; 
import { ImportPaymentsController } from './controllers/ImportPaymentsController';
import { ImportDevolutionsController } from './controllers/ImportDevolutionsController'; // 👈 1. Importado o novo Controller
import { StoreController } from './controllers/StoreController';
import { BatchController } from './controllers/BatchController'; 
import { FreteController } from './controllers/FreteController';

const routes = Router();
const authController = new AuthController();
const importSalesController = new ImportSalesController();
const paymentsController = new ImportPaymentsController();
const devolutionsController = new ImportDevolutionsController(); // 👈 2. Instanciado o Controller
const marketplaceController = new MarketplaceController(); 
const saleController = new SaleController();               
const storeController = new StoreController();
const batchController = new BatchController(); 
const freteController = new FreteController(); 


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

// --- FLUXOS DE IMPORTAÇÃO (Gera os lotes de Vendas, Pagamentos ou Devoluções) ---
routes.post('/sales/import', authMiddleware, importSalesController.importData);   
routes.post('/payments/import', authMiddleware, paymentsController.importData);
routes.post('/devolutions/import', authMiddleware, devolutionsController.importData);

// --- 📦 NOVAS ROTAS CENTRALIZADAS E UNIFICADAS DE LOTES (BATCHES) ---
// Nota: Suas rotas unificadas abaixo já vão listar, detalhar e deletar os lotes de devolução automaticamente 
// através do BatchController que você já possui criado!
routes.get('/batches', authMiddleware, batchController.list);            
routes.get('/batches/:id', authMiddleware, batchController.getDetails);  
routes.patch('/batches/:id/rename', authMiddleware, batchController.rename); 
routes.delete('/batches/:id', authMiddleware, batchController.delete);      

// 🏪 ROTAS DE MARKETPLACE
routes.post('/marketplaces', authMiddleware, marketplaceController.create); 
routes.get('/marketplaces', authMiddleware, marketplaceController.list);
routes.put('/marketplaces/:id', authMiddleware, marketplaceController.update);
routes.delete('/marketplaces/:id', authMiddleware, marketplaceController.delete);

// 💰 ROTAS DE VENDAS
routes.post('/sales', authMiddleware, saleController.create);
routes.get('/sales', authMiddleware, saleController.list);
routes.get('/sales/export', authMiddleware, saleController.exportSales);
routes.get('/sales/summary', authMiddleware, saleController.summary); 
routes.get('/sales/:id', authMiddleware, saleController.show);
routes.put('/sales/:id', authMiddleware, saleController.update);
routes.delete('/sales/:id', authMiddleware, saleController.delete);

// 🏬 ROTAS DAS LOJAS
routes.post('/stores', authMiddleware, storeController.create);
routes.get('/stores', authMiddleware, storeController.list);
routes.put('/stores/:id', authMiddleware, storeController.update);
routes.delete('/stores/:id', authMiddleware, storeController.delete);

// 🏷️ ROTAS DE FRETE
routes.get('/vendas/frete', freteController.list);
routes.post('/vendas/frete/import', freteController.import);

export { routes };