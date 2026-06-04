import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  HasMany,
  ForeignKey,
  BelongsTo
} from 'sequelize-typescript';

// ==========================================
// 1. MODEL: USER
// ==========================================
@Table({ tableName: 'users', timestamps: true })
export class User extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;

  @Column({ type: DataType.STRING, unique: true })
  declare email: string;

  @Column({ type: DataType.STRING, field: 'password_hash' })
  declare passwordHash: string;
}

// ==========================================
// 2. MODEL: BATCH (Lote de Importação)
// ==========================================
@Table({ tableName: 'batches', timestamps: true })
export class Batch extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;

  @Column({
    type: DataType.ENUM('SALES', 'PAYMENTS'),
    allowNull: false,
    defaultValue: 'SALES'
  })
  declare type: 'SALES' | 'PAYMENTS';

  @HasMany(() => Sale, { onDelete: 'CASCADE' })
  declare sales: Sale[];

  @HasMany(() => Payment, { onDelete: 'CASCADE' })
  declare payments: Payment[];
}

// ==========================================
// 3. MODEL: MARKETPLACE
// ==========================================
@Table({ tableName: 'marketplaces', timestamps: false })
export class Marketplace extends Model {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;

  @HasMany(() => Store)
  declare stores: Store[];
}

// ==========================================
// 4. MODEL: STORE (Lojas físicas/virtuais)
// ==========================================
@Table({ tableName: 'stores', timestamps: false })
export class Store extends Model {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column({ type: DataType.STRING, unique: true })
  declare name: string;

  @ForeignKey(() => Marketplace)
  @Column(DataType.STRING)
  declare marketplaceId: string;

  @BelongsTo(() => Marketplace)
  declare marketplace: Marketplace;

  @HasMany(() => Sale)
  declare sales: Sale[];

  @HasMany(() => Payment)
  declare payments: Payment[];
}

// ==========================================
// 5. MODEL: SALE (Vendas individuais)
// ==========================================
@Table({ tableName: 'sales', timestamps: true })
export class Sale extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare nf: string;

  @Column(DataType.DATEONLY)
  declare date: Date;

  @Column({
    type: DataType.DECIMAL(10, 2),
    get() {
      const value = this.getDataValue('baseIcms');
      return value ? Number(value) : 0;
    }
  })
  declare baseIcms: number;

  // 👇 NOVO: Adicionado campo status mapeando suas opções financeiras
  @Column({
    type: DataType.ENUM(
      'PENDENTE',
      'PARCIALMENTE_PAGO',
      'PARCIALMENTE_REEMBOLSADO',
      'PARCIALMENTE_CONTESTACAO',
      'PARCIALMENTE_DEVOLVIDO',
      'REEMBOLSADO',
      'CONTESTACAO',
      'DEVOLVIDO',
      'PAGO',
      'CANCELADO',
      'FINALIZADO'
    ),
    allowNull: false,
    defaultValue: 'PENDENTE'
  })
  declare status: 'PENDENTE' | 'PARCIALMENTE_PAGO' | 'PARCIALMENTE_REEMBOLSADO' | 'PARCIALMENTE_CONTESTACAO' | 'PARCIALMENTE_DEVOLVIDO' | 'REEMBOLSADO' | 'CONTESTACAO' | 'DEVOLVIDO' | 'PAGO' | 'CANCELADO' | 'FINALIZADO';

  @ForeignKey(() => Store)
  @Column(DataType.STRING)
  declare storeId: string;

  @BelongsTo(() => Store)
  declare store: Store;

  @ForeignKey(() => Batch)
  @Column(DataType.UUID)
  declare batchId: string;

  @BelongsTo(() => Batch)
  declare batch: Batch;

  @HasMany(() => Payment)
  declare payments: Payment[];
}

// ==========================================
// 6. MODEL: PAYMENT (Pagamentos / Repasses)
// ==========================================
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