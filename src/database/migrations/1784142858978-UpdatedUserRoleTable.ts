import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedUserRoleTable1784142858978 implements MigrationInterface {
    name = 'UpdatedUserRoleTable1784142858978'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_63f038e4b86436ae6729e65a3c"`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "email" character varying(255) NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."user_roles_status_enum" AS ENUM('active', 'invited')`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "status" "public"."user_roles_status_enum" NOT NULL DEFAULT 'invited'`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "invited_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "joined_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "user_roles" ALTER COLUMN "user_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_roles" ALTER COLUMN "name" DROP NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_446f99844e9b5de01d269aabc5" ON "user_roles"  ("email", "company_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_446f99844e9b5de01d269aabc5"`);
        await queryRunner.query(`ALTER TABLE "user_roles" ALTER COLUMN "name" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_roles" ALTER COLUMN "user_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "joined_at"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "invited_at"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."user_roles_status_enum"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "email"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_63f038e4b86436ae6729e65a3c" ON "user_roles" USING btree ("company_id", "user_id") `);
    }

}
