// src/utils/friendlyError.ts
// Traduz erros técnicos do Sequelize (principalmente "Validation error" de
// unicidade/formato) em mensagens legíveis pra quem está importando uma planilha,
// em vez do "Validation error" genérico que não diz nada sobre o que deu errado.
// Não muda nenhuma regra de negócio — só formata a mensagem antes de responder.

const FIELD_LABELS: Record<string, string> = {
  name: 'nome da loja',
  id: 'identificador',
  nf: 'nota fiscal',
  marketplaceId: 'marketplace',
  storeId: 'loja',
};

export function friendlyImportError(error: any): string {
  const validationErrors = error?.errors;

  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    const details = validationErrors
      .map((e: any) => {
        const campo = FIELD_LABELS[e.path] || e.path || 'um campo';
        const valor = e.value !== undefined && e.value !== null && e.value !== '' ? ` "${e.value}"` : '';
        const isUnique = e.type === 'unique violation' || e.validatorKey === 'not_unique';
        return isUnique
          ? `já existe um registro com esse ${campo}${valor}`
          : `${campo}${valor} está inválido`;
      })
      .join('; ');

    return `Não foi possível concluir a importação: ${details}. Verifique os dados da planilha e tente novamente.`;
  }

  if (error?.name === 'SequelizeValidationError' || error?.name === 'SequelizeUniqueConstraintError') {
    return 'Não foi possível concluir a importação: alguns dados da planilha não passaram na validação do sistema. Verifique os valores e tente novamente.';
  }

  return error?.message || 'Ocorreu um erro inesperado ao processar a importação. Tente novamente.';
}
