import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTripAndTripStopTable1784122924202 implements MigrationInterface {
    name = 'AddTripAndTripStopTable1784122924202'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "trips" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "driver_user_id" uuid NOT NULL, "created_by_user_id" uuid NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f71c231dee9c05a9522f9e840f5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ee38d00bcd1ef4a005bab44c0a" ON "trips"  ("company_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_53a3cd3f630a3e295a6c1cca20" ON "trips"  ("company_id", "driver_user_id") `);
        await queryRunner.query(`CREATE TYPE "public"."trip_stops_status_enum" AS ENUM('pending', 'arrived', 'completed', 'skipped', 'failed')`);
        await queryRunner.query(`CREATE TYPE "public"."trip_stops_skip_reason_enum" AS ENUM('customer_unavailable', 'wrong_address', 'customer_refused', 'access_issue', 'other')`);
        await queryRunner.query(`CREATE TABLE "trip_stops" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trip_id" uuid NOT NULL, "order_id" uuid NOT NULL, "sequence" integer NOT NULL, "status" "public"."trip_stops_status_enum" NOT NULL DEFAULT 'pending', "arrived_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "skip_reason" "public"."trip_stops_skip_reason_enum", "skip_note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_302c88bdaf02574eb5515217f05" UNIQUE ("order_id"), CONSTRAINT "PK_876633f878970267cb0dc525984" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5cb5ec6432abdf6f1e1c3a0970" ON "trip_stops"  ("trip_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_42bce8bae8e69fc59dc0851ed3" ON "trip_stops"  ("trip_id", "sequence") `);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_ee38d00bcd1ef4a005bab44c0a4" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD CONSTRAINT "FK_5cb5ec6432abdf6f1e1c3a0970c" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD CONSTRAINT "FK_302c88bdaf02574eb5515217f05" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP CONSTRAINT "FK_302c88bdaf02574eb5515217f05"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP CONSTRAINT "FK_5cb5ec6432abdf6f1e1c3a0970c"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_ee38d00bcd1ef4a005bab44c0a4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_42bce8bae8e69fc59dc0851ed3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5cb5ec6432abdf6f1e1c3a0970"`);
        await queryRunner.query(`DROP TABLE "trip_stops"`);
        await queryRunner.query(`DROP TYPE "public"."trip_stops_skip_reason_enum"`);
        await queryRunner.query(`DROP TYPE "public"."trip_stops_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_53a3cd3f630a3e295a6c1cca20"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee38d00bcd1ef4a005bab44c0a"`);
        await queryRunner.query(`DROP TABLE "trips"`);
    }

}
