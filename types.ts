
export enum AppState {
  IDLE = 'IDLE',
  SETUP = 'SETUP', // Entering user name
  WAITING = 'WAITING', // Online, waiting for peer or handshake
  HANDSHAKE = 'HANDSHAKE',
  CONNECTED = 'CONNECTED',
  SENDING = 'SENDING',
  RECEIVING = 'RECEIVING',
  ERROR = 'ERROR'
}

export enum PacketType {
  HANDSHAKE_INIT = 0x01,
  HANDSHAKE_RESP = 0x02,
  DATA_MSG = 0x03,
  RETRY_REQ = 0x04,
  DISCONNECT = 0x05,
  VAULT_ENTRY = 0x10
}

export interface Message {
  id: string;
  sender: 'self' | 'peer';
  text: string;
  senderName?: string;
  timestamp: number;
  status: 'sending' | 'delivered' | 'received' | 'error';
}
