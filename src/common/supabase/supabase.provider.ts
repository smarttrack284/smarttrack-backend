import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import {
    SUPABASE_CLIENT,
    SUPABASE_PUBLIC
} from "#/common/constants/supabase.constant";

export const SupabaseAdminProvider: Provider = {
    provide: SUPABASE_CLIENT,

    inject: [ConfigService],

    useFactory: (config: ConfigService): SupabaseClient => {
        const url = config.getOrThrow<string>("SUPABASE_URL");
        const serviceRoleKey = config.getOrThrow<string>(
            "SUPABASE_SECRET_ROLE_KEY"
        );

        return createClient(url, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            },

            global: {
                headers: {
                    "X-Client-Info": "nestjs-backend"
                }
            }
        });
    }
};
export const SupabasePublicProvider: Provider = {
    provide: SUPABASE_PUBLIC,

    inject: [ConfigService],

    useFactory: (config: ConfigService): SupabaseClient => {
        const url = config.getOrThrow<string>("SUPABASE_URL");
        const publishableKey = config.getOrThrow<string>(
            "SUPABASE_PUBLISHABLE_KEY"
        );

        return createClient(url, publishableKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            },

            global: {
                headers: {
                    "X-Client-Info": "nestjs-backend"
                }
            }
        });
    }
};
