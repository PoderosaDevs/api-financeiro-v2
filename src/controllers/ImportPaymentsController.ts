import { Request, Response } from 'express';
import { ImportPaymentsService } from '../services/ImportPaymentsService';
import { friendlyImportError } from '../utils/friendlyError';

const paymentsService = new ImportPaymentsService();

export class ImportPaymentsController {

    // Recebe o JSON da planilha de repasses e roda a auditoria profunda
    importData = async (req: Request, res: Response) => {
        console.log(`[PaymentsController] [importData] 📥 Iniciando auditoria e importação de lote de pagamentos...`);
        try {
            const result = await paymentsService.execute(req.body);
            
            console.log(`[PaymentsController] [importData] ✅ Auditoria concluída. Lote de pagamentos ID: ${result?.batchId} | Inseridos: ${result?.salesImported}`);
            return res.status(201).json(result);
        } catch (error: any) {
            console.error(`[PaymentsController] [importData] ❌ Falha na auditoria/importação de pagamentos:`, {
                message: error.message,
                stack: error.stack
            });
            return res.status(400).json({ error: friendlyImportError(error) });
        }
    }

    // Lista todos os lotes de pagamentos cadastrados com paginação
    listBatches = async (req: Request, res: Response) => {
        const page = req.query.page ? Number(req.query.page) : 1;
        const limit = req.query.limit ? Number(req.query.limit) : 10;

        console.log(`[PaymentsController] [listBatches] 📥 Requisição recebida - Página: ${page} | Limite: ${limit}`);
        try {
            const result = await paymentsService.listBatches(page, limit);

            console.log(`[PaymentsController] [listBatches] ✅ Lotes de pagamentos recuperados. Total: ${result?.meta?.totalRecords ?? 0}`);
            return res.json(result);
        } catch (error: any) {
            console.error(`[PaymentsController] [listBatches] ❌ Erro fatal ao listar lotes de pagamentos:`, {
                message: error.message,
                stack: error.stack,
                params: { page, limit }
            });

            return res.status(500).json({
                error: "Falha interna no servidor ao processar listagem de lotes de pagamentos.",
                message: error.message
            });
        }
    }

    // Confere as parcelas de pagamentos de um lote específico
    checkBatch = async (req: Request, res: Response) => {
        const { id } = req.params;
        console.log(`[PaymentsController] [checkBatch] 🔍 Buscando detalhes do lote de pagamentos ID: ${id}`);
        try {
            const batchDetails = await paymentsService.getBatchDetails(id);
            
            console.log(`[PaymentsController] [checkBatch] ✅ Detalhes do lote de pagamentos ${id} recuperados com sucesso.`);
            return res.json(batchDetails);
        } catch (error: any) {
            console.error(`[PaymentsController] [checkBatch] ❌ Lote de pagamentos ${id} não localizado ou erro na busca:`, {
                message: error.message,
                stack: error.stack
            });
            return res.status(404).json({ error: error.message });
        }
    }

    // Deleta um lote inteiro de pagamentos (e suas parcelas via CASCADE)
    removeBatch = async (req: Request, res: Response) => {
        const { id } = req.params;
        console.log(`[PaymentsController] [removeBatch] ⚠️ Solicitada exclusão do lote de pagamentos ID: ${id}`);
        try {
            const result = await paymentsService.deleteBatch(id);
            
            console.log(`[PaymentsController] [removeBatch] 🗑️ Lote de pagamentos ${id} e conciliações retroativas processadas.`);
            return res.json(result);
        } catch (error: any) {
            console.error(`[PaymentsController] [removeBatch] ❌ Erro ao tentar remover o lote de pagamentos ${id}:`, {
                message: error.message,
                stack: error.stack
            });
            return res.status(404).json({ error: error.message });
        }
    }
}