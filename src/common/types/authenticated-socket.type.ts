import type { Socket } from 'socket.io';
import type { AuthenticatedUser } from './authenticated-user.type';

export type AuthenticatedSocket = Socket & {
  data: { user?: AuthenticatedUser };
};
