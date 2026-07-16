import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { UsersService } from "#/modules/users/users.service";
import { DispatchService } from "./dispatch.service";
import { DispatchOrdersDto } from "./dto/dispatch-orders.dto";
import { SkipStopDto } from "./dto/skip-stop.dto";
import { ListTripsQueryDto } from "./dto/list-trips.query.dto";

@UseGuards(SupabaseAuthGuard)
@Controller("dispatch/trips")
export class DispatchController {
    constructor(
        private readonly dispatchService: DispatchService,
        private readonly usersService: UsersService
    ) {}

    @Post()
    async dispatchOrders(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: DispatchOrdersDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        
        await this.dispatchService.dispatchOrdersToDriver(
            userRole.companyId,
            user.id,
            dto
        );
        // const fullTrip = await this.dispatchService.getTripForCompany(
        //             trip.id,
        //             userRole.companyId
        //         );
        // return this.dispatchService.toTripResponse(fullTrip);
        return { success: true };
    }

    @Get()
    async listTrips(
        @CurrentUser() user: AuthenticatedUser,
        @Query() query: ListTripsQueryDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        const { trips, total, page, pageSize } =
            await this.dispatchService.listTripsForCompany(
                userRole.companyId,
                query
            );
        return {
            trips: trips.map(t => this.dispatchService.toTripResponse(t)),
            total,
            page,
            pageSize
        };
    }

    @Get(":tripId")
    async findTrip(
        @CurrentUser() user: AuthenticatedUser,
        @Param("tripId", ParseUUIDPipe) tripId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        const trip = await this.dispatchService.getTripForCompany(
            tripId,
            userRole.companyId
        );
        return this.dispatchService.toTripResponse(trip);
    }

    @Patch(":tripId/stops/:stopId/arrive")
    async arriveStop(
        @CurrentUser() user: AuthenticatedUser,
        @Param("tripId", ParseUUIDPipe) tripId: string,
        @Param("stopId", ParseUUIDPipe) stopId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.dispatchService.arriveAtStop(
            tripId,
            stopId,
            userRole.companyId
        );
    }

    @Patch(":tripId/stops/:stopId/complete")
    async completeStop(
        @CurrentUser() user: AuthenticatedUser,
        @Param("tripId", ParseUUIDPipe) tripId: string,
        @Param("stopId", ParseUUIDPipe) stopId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.dispatchService.completeStop(
            tripId,
            stopId,
            userRole.companyId
        );
    }

    @Patch(":tripId/stops/:stopId/skip")
    async skipStop(
        @CurrentUser() user: AuthenticatedUser,
        @Param("tripId", ParseUUIDPipe) tripId: string,
        @Param("stopId", ParseUUIDPipe) stopId: string,
        @Body() dto: SkipStopDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.dispatchService.skipStop(
            tripId,
            stopId,
            userRole.companyId,
            dto
        );
    }
}
