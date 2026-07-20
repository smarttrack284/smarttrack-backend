import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from "typeorm";
import { Trip } from "./trip.entity";
import { Order } from "./order.entity";
import {
    StopStatus,
    SkipReasonCode
} from "#/common/constants/stop-status.constant";

export enum ProofOfDeliveryMethod {
  PHOTO = 'photo',
  SIGNATURE = 'signature',
  PHOTO_AND_SIGNATURE = 'photo_and_signature',
}
/**
 * Deliberately normalized — no customerName/pickupLocation/etc duplicated
 * here. Those live on Order and are joined at read time (see
 * DispatchService.buildTripResponse), so there's exactly one place that
 * data can live and go stale.
 */
@Entity("trip_stops")
@Index(["tripId", "sequence"])
export class TripStop {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "trip_id", type: "uuid" })
    @Index()
    tripId: string;

    @ManyToOne(() => Trip, trip => trip.stops, { onDelete: "CASCADE" })
    @JoinColumn({ name: "trip_id" })
    trip: Trip;

    /** Unique — an order can only be an active stop on one trip at a time. Defense-in-depth alongside OrdersService's PENDING->ASSIGNED transition guard. */
    @Column({ name: "order_id", type: "uuid", unique: true })
    orderId: string;

    @ManyToOne(() => Order, { onDelete: "CASCADE" })
    @JoinColumn({ name: "order_id" })
    order: Order;

    @Column({ type: "int" })
    sequence: number;

    @Column({ type: "enum", enum: StopStatus, default: StopStatus.PENDING })
    status: StopStatus;

    @Column({ name: "arrived_at", type: "timestamptz", nullable: true })
    arrivedAt: Date | null;

    @Column({ name: "completed_at", type: "timestamptz", nullable: true })
    completedAt: Date | null;

    @Column({
        name: "skip_reason",
        type: "enum",
        enum: SkipReasonCode,
        nullable: true
    })
    skipReason: SkipReasonCode | null;

    @Column({ name: "skip_note", type: "text", nullable: true })
    skipNote: string | null;

    @Column({
        name: "pod_method",
        type: "enum",
        enum: ProofOfDeliveryMethod,
        nullable: true
    })
    podMethod: ProofOfDeliveryMethod | null;

    @Column({
        name: "pod_photo_url",
        type: "varchar",
        length: 500,
        nullable: true
    })
    podPhotoUrl: string | null;

    @Column({
        name: "pod_signature_url",
        type: "varchar",
        length: 500,
        nullable: true
    })
    podSignatureUrl: string | null;

    @Column({
        name: "pod_recipient_name",
        type: "varchar",
        length: 255,
        nullable: true
    })
    podRecipientName: string | null;

    @Column({ name: "pod_notes", type: "text", nullable: true })
    podNotes: string | null;

    @Column({ name: "pod_captured_at", type: "timestamptz", nullable: true })
    podCapturedAt: Date | null;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
