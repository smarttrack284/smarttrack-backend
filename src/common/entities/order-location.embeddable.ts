import { Column } from 'typeorm';

/** Embedded (not its own table) — matches the frontend's OrderLocation shape exactly, reused for both pickup and dropoff via TypeORM's column prefixing. */
export class OrderLocationEmbed {
  @Column({ type: 'varchar', length: 255 })
  label: string;

  @Column({ type: 'varchar', length: 500 })
  address: string;

  @Column({ type: 'double precision' })
  lat: number;

  @Column({ type: 'double precision' })
  lng: number;
}
