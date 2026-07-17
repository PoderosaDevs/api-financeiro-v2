// src/models/Frete.ts
import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
} from 'sequelize-typescript';

@Table({ tableName: 'fretes', timestamps: true })
export class Frete extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare nf: string;

  @Column(DataType.STRING)
  declare storeId: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare numeroFatura: string | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare fretePago: boolean;
}