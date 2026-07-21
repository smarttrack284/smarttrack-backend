import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedTripStopTable1784575361208 implements MigrationInterface {
    name = 'UpdatedTripStopTable1784575361208'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."trip_stops_pod_method_enum" AS ENUM('photo', 'signature', 'photo_and_signature')`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD "pod_method" "public"."trip_stops_pod_method_enum"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD "pod_photo_url" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD "pod_signature_url" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD "pod_recipient_name" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD "pod_notes" text`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD "pod_captured_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "pod_captured_at"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "pod_notes"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "pod_recipient_name"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "pod_signature_url"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "pod_photo_url"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "pod_method"`);
        await queryRunner.query(`DROP TYPE "public"."trip_stops_pod_method_enum"`);
    }

}
