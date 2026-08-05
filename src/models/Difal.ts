// src/models/Difal.ts
import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
} from 'sequelize-typescript';

@Table({ tableName: 'difais', timestamps: true })
export class Difal extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare nf: string;

  @Column(DataType.STRING)
  declare storeId: string;

  @Column({
    type: DataType.STRING(2),
    allowNull: false,
  })
  declare estado: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  declare valor: number;

  // DATEONLY evita o bug clássico de fuso horário (a data vem "pura",
  // sem componente de hora, então não sofre o -1 dia do toLocaleDateString no front)
  @Column({
    type: DataType.DATEONLY,
    allowNull: true,
  })
  declare data: string | null;

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
  declare difalRecolhido: boolean;
}