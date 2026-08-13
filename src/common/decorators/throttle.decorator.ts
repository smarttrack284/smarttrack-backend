import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle';
export const AuthThrottle = () => SetMetadata(THROTTLE_KEY, 'auth');
export const UploadThrottle = () => SetMetadata(THROTTLE_KEY, 'upload');
export const PublicThrottle = () => SetMetadata(THROTTLE_KEY, 'public');
export const WebhookThrottle = () => SetMetadata(THROTTLE_KEY, 'webhook');
export const APIThrottle = () => SetMetadata(THROTTLE_KEY, 'api');
