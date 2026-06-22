import { User } from './User';
import { Batch } from './Batch';
import { Marketplace } from './Marketplace';
import { Store } from './Store';
import { Sale } from './Sale';
import { Payment } from './Payment';
import { Devolution } from './Devolution'; // Incluindo o modelo de devolução

// 1. Exportação individual de cada modelo para facilitar o uso no resto do sistema
// Exemplo de uso: import { Sale, Payment } from './models';
export {
  User,
  Batch,
  Marketplace,
  Store,
  Sale,
  Payment,
  Devolution
};

// 2. Exportação de uma lista contendo todos os modelos.
// Esta lista é passada diretamente na configuração da instância do Sequelize.
export const models = [
  User,
  Batch,
  Marketplace,
  Store,
  Sale,
  Payment,
  Devolution
];