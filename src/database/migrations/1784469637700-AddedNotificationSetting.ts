import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedNotificationSetting1784469637700 implements MigrationInterface {
    name = 'AddedNotificationSetting1784469637700'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_446f99844e9b5de01d269aabc5"`);
        await queryRunner.query(`CREATE TABLE "notification_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "email_order_created" boolean NOT NULL DEFAULT true, "email_order_assigned" boolean NOT NULL DEFAULT true, "email_order_picked_up" boolean NOT NULL DEFAULT true, "email_order_delivered" boolean NOT NULL DEFAULT true, "email_order_failed" boolean NOT NULL DEFAULT true, "email_order_cancelled" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_91a7ffebe8b406c4470845d4781" UNIQUE ("user_id"), CONSTRAINT "REL_91a7ffebe8b406c4470845d478" UNIQUE ("user_id"), CONSTRAINT "PK_d131abd7996c475ef768d4559ba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_91a7ffebe8b406c4470845d478" ON "notification_settings"  ("user_id") `);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "UQ_87b8888186ca9769c960e926870" UNIQUE ("user_id")`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "UQ_fb8c5b62ab5a7a949b36664e19a" UNIQUE ("email")`);
        await queryRunner.query(`ALTER TABLE "notification_settings" ADD CONSTRAINT "FK_91a7ffebe8b406c4470845d4781" FOREIGN KEY ("user_id") REFERENCES "user_roles"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notification_settings" DROP CONSTRAINT "FK_91a7ffebe8b406c4470845d4781"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "UQ_fb8c5b62ab5a7a949b36664e19a"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "UQ_87b8888186ca9769c960e926870"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_91a7ffebe8b406c4470845d478"`);
        await queryRunner.query(`DROP TABLE "notification_settings"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_446f99844e9b5de01d269aabc5" ON "user_roles" USING btree ("company_id", "email") `);
    }

}
