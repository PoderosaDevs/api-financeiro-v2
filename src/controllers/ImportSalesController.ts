import { Request, Response } from 'express';
import { ImportSalesService } from '../services/ImportSalesService';
import { friendlyImportError } from '../utils/friendlyError';

const importService = new ImportSalesService();

export class ImportSalesController {
  
  // Recebe o JSON gigante e roda a importação
  importData = async (req: Request, res: Response) => {
    console.log(`[SalesController] [importData] 📥 Iniciando importação de lote de vendas...`);
    try {
      const result = await importService.execute(req.body);
      
      console.log(`[SalesController] [importData] ✅ Lote de vendas processado. ID: ${result?.batchId} | Sucessos: ${result?.salesImported}`);
      return res.status(201).json(result);
    } catch (error: any) {
      console.error(`[SalesController] [importData] ❌ Erro ao processar importação de vendas:`, {
        message: error.message,
        stack: error.stack
      });
      return res.status(400).json({ error: friendlyImportError(error) });
    }
  }

  // Lista todos os lotes cadastrados com suporte a paginação via query string
  listBatches = async (req: Request, res: Response) => {
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 10;

    console.log(`[SalesController] [listBatches] 📥 Requisição recebida - Página: ${page} | Limite: ${limit}`);
    try {
      const result = await importService.listBatches(page, limit);
      
      console.log(`[SalesController] [listBatches] ✅ Lotes de vendas recuperados. Total: ${result?.meta?.totalRecords ?? 0}`);
      return res.json(result);
    } catch (error: any) {
      console.error(`[SalesController] [listBatches] ❌ Erro fatal ao listar lotes de vendas:`, {
        message: error.message,
        stack: error.stack,
        params: { page, limit }
      });
      return res.status(500).json({ 
        error: "Falha interna no servidor ao processar listagem de lotes de vendas.",
        message: error.message 
      });
    }
  }

  // Confere as vendas de um lote específico
  checkBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[SalesController] [checkBatch] 🔍 Buscando detalhes do lote de vendas ID: ${id}`);
    try {
      const batchDetails = await importService.getBatchDetails(id);
      
      console.log(`[SalesController] [checkBatch] ✅ Detalhes do lote de vendas ${id} recuperados com sucesso.`);
      return res.json(batchDetails);
    } catch (error: any) {
      console.error(`[SalesController] [checkBatch] ❌ Lote de vendas ${id} não localizado ou erro na busca:`, {
        message: error.message,
        stack: error.stack
      });
      return res.status(404).json({ error: error.message });
    }
  }

  // Deleta um lote inteiro de vendas
  removeBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[SalesController] [removeBatch] ⚠️ Solicitada exclusão do lote de vendas ID: ${id}`);
    try {
      const result = await importService.deleteBatch(id);
      
      console.log(`[SalesController] [removeBatch] 🗑️ Lote de vendas ${id} e registros associados deletados.`);
      return res.json(result);
    } catch (error: any) {
      console.error(`[SalesController] [removeBatch] ❌ Erro ao tentar remover o lote de vendas ${id}:`, {
        message: error.message,
        stack: error.stack
      });
      return res.status(404).json({ error: error.message });
    }
  }
}