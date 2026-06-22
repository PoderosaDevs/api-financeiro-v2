import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  ForeignKey,
  BelongsTo
} from 'sequelize-typescript';
import { Batch } from './Batch';
import { Store } from './Store';
import { Sale } from './Sale';

@Table({ tableName: 'payments', timestamps: true })
export class Payment extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare nf: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'raw_store_name' })
  declare rawStoreName: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'parcela_paga' })
  declare parcelaPaga: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare parcelas: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    field: 'base_icms',
    get() {
      const value = this.getDataValue('baseIcms');
      return value ? Number(value) : 0;
    }
  })
  declare baseIcms: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    get() {
      const value = this.getDataValue('repasse');
      return value ? Number(value) : 0;
    }
  })
  declare repasse: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    field: 'comissao_venda',
    get() {
      const value = this.getDataValue('comissaoVenda');
      return value ? Number(value) : 0;
    }
  })
  declare comissaoVenda: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    field: 'comissao_frete',
    get() {
      const value = this.getDataValue('comissaoFrete');
      return value ? Number(value) : 0;
    }
  })
  declare comissaoFrete: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0,
    field: 'fretes_taxas',
    get() {
      const value = this.getDataValue('fretesTaxas');
      return value ? Number(value) : 0;
    }
  })
  declare fretesTaxas: number;

  @ForeignKey(() => Batch)
  @Column({ type: DataType.UUID, allowNull: false, field: 'batch_id' })
  declare batchId: string;

  @BelongsTo(() => Batch)
  declare batch: Batch;

  @ForeignKey(() => Store)
  @Column({ type: DataType.STRING, allowNull: true, field: 'store_id' })
  declare storeId: string;

  @BelongsTo(() => Store)
  declare store: Store;

  @ForeignKey(() => Sale)
  @Column({ type: DataType.UUID, allowNull: true, field: 'sale_id' })
  declare saleId: string;

  @BelongsTo(() => Sale)
  declare sale: Sale;
}