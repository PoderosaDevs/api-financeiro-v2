import { Request, Response } from 'express';
import { ImportDevolutionsService } from '../services/ImportDevolutionsService';

const devolutionsService = new ImportDevolutionsService();

export class ImportDevolutionsController {

    // Recebe o JSON da planilha de devoluções e roda a auditoria profunda
    importData = async (req: Request, res: Response) => {
        console.log(`[DevolutionsController] [importData] 📥 Iniciando auditoria e importação de lote de devoluções...`);
        try {
            const result = await devolutionsService.execute(req.body);
            
            console.log(`[DevolutionsController] [importData] ✅ Auditoria concluída. Lote de devoluções ID: ${result?.batchId} | Inseridos: ${result?.salesImported}`);
            return res.status(201).json(result);
        } catch (error: any) {
            console.error(`[DevolutionsController] [importData] ❌ Falha na auditoria/importação de devoluções:`, {
                message: error.message,
                stack: error.stack
            });
            return res.status(400).json({ error: error.message });
        }
    }

    // Lista todos os lotes de devoluções cadastrados com paginação
    listBatches = async (req: Request, res: Response) => {
        const page = req.query.page ? Number(req.query.page) : 1;
        const limit = req.query.limit ? Number(req.query.limit) : 10;

        console.log(`[DevolutionsController] [listBatches] 📥 Requisição recebida - Página: ${page} | Limite: ${limit}`);
        try {
            const result = await devolutionsService.listBatches(page, limit);

            console.log(`[DevolutionsController] [listBatches] ✅ Lotes de devoluções recuperados. Total: ${result?.meta?.totalRecords ?? 0}`);
            return res.json(result);
        } catch (error: any) {
            console.error(`[DevolutionsController] [listBatches] ❌ Erro fatal ao listar lotes de devoluções:`, {
                message: error.message,
                stack: error.stack,
                params: { page, limit }
            });

            return res.status(500).json({
                error: "Falha interna no servidor ao processar listagem de lotes de devoluções.",
                message: error.message
            });
        }
    }

    // Confere as parcelas de devoluções de um lote específico
    checkBatch = async (req: Request, res: Response) => {
        const { id } = req.params;
        console.log(`[DevolutionsController] [checkBatch] 🔍 Buscando detalhes do lote de devoluções ID: ${id}`);
        try {
            // Nota: o método getBatchDetails herda a busca do Batch com include no serviço
            const batchDetails = await devolutionsService.getBatchDetails(id);
            
            console.log(`[DevolutionsController] [checkBatch] ✅ Detalhes do lote de devoluções ${id} recuperados com sucesso.`);
            return res.json(batchDetails);
        } catch (error: any) {
            console.error(`[DevolutionsController] [checkBatch] ❌ Lote de devoluções ${id} não localizado ou erro na busca:`, {
                message: error.message,
                stack: error.stack
            });
            return res.status(404).json({ error: error.message });
        }
    }

    // Deleta um lote inteiro de devoluções (e suas parcelas via CASCADE)
    removeBatch = async (req: Request, res: Response) => {
        const { id } = req.params;
        console.log(`[DevolutionsController] [removeBatch] ⚠️ Solicitada exclusão do lote de devoluções ID: ${id}`);
        try {
            const result = await devolutionsService.deleteBatch(id);
            
            console.log(`[DevolutionsController] [removeBatch] 🗑️ Lote de devoluções ${id} e reprocessamento de status concluídos.`);
            return res.json(result);
        } catch (error: any) {
            console.error(`[DevolutionsController] [removeBatch] ❌ Erro ao tentar remover o lote de devoluções ${id}:`, {
                message: error.message,
                stack: error.stack
            });
            return res.status(404).json({ error: error.message });
        }
    }
}