import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedUserRoleTable1786047073325 implements MigrationInterface {
    name = 'UpdatedUserRoleTable1786047073325'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "FK_df162a656b0dd26d4f1b76089ce" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_df162a656b0dd26d4f1b76089ce"`);
    }

}
