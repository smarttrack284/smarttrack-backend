import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedAndUpdatedSomeTables1784101163661 implements MigrationInterface {
    name = 'AddedAndUpdatedSomeTables1784101163661'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_fkey"`);
        await queryRunner.query(`CREATE TYPE "public"."orders_priority_enum" AS ENUM('low', 'normal', 'high', 'urgent')`);
        await queryRunner.query(`CREATE TYPE "public"."orders_status_enum" AS ENUM('pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'failed')`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "order_reference" character varying(255) NOT NULL, "tracking_number" character varying(32) NOT NULL, "customer_name" character varying(255) NOT NULL, "customer_phone" character varying(32) NOT NULL, "pickup_saved_location_id" uuid, "priority" "public"."orders_priority_enum" NOT NULL DEFAULT 'normal', "status" "public"."orders_status_enum" NOT NULL DEFAULT 'pending', "scheduled_for" TIMESTAMP WITH TIME ZONE, "notes" text, "created_by_user_id" uuid NOT NULL, "assigned_driver_user_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "pickupLabel" character varying(255) NOT NULL, "pickupAddress" character varying(500) NOT NULL, "pickupLat" double precision NOT NULL, "pickupLng" double precision NOT NULL, "dropoffLabel" character varying(255) NOT NULL, "dropoffAddress" character varying(500) NOT NULL, "dropoffLat" double precision NOT NULL, "dropoffLng" double precision NOT NULL, CONSTRAINT "UQ_aafadefd70155200d8914ceaf90" UNIQUE ("tracking_number"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f5d519a61e918f7efb299de31a" ON "orders"  ("company_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_aafadefd70155200d8914ceaf9" ON "orders"  ("tracking_number") `);
        await queryRunner.query(`CREATE INDEX "IDX_775c9f06fc27ae3ff8fb26f2c4" ON "orders"  ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_281966b431ed8a7acfbf03e852" ON "orders"  ("assigned_driver_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_4bf57bd09c3bb6b7019cdfd9e0" ON "orders"  ("company_id", "status") `);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_145532db85752b29c57d2b7b1f" ON "order_items"  ("order_id") `);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_f5d519a61e918f7efb299de31a0" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_f5d519a61e918f7efb299de31a0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_145532db85752b29c57d2b7b1f"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4bf57bd09c3bb6b7019cdfd9e0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_281966b431ed8a7acfbf03e852"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_775c9f06fc27ae3ff8fb26f2c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aafadefd70155200d8914ceaf9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f5d519a61e918f7efb299de31a"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."orders_priority_enum"`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
