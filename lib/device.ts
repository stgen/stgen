import {
  Device as STDevice,
  Component as STComponent,
  Capability as STCapability,
  SmartThingsClient,
  DeviceEvent,
} from '@smartthings/core-sdk';

export class Device<TStatus> {
  readonly id: string;
  constructor(readonly client: SmartThingsClient, readonly raw: STDevice) {
    this.id = raw.deviceId!;
  }
  async getStatus(): Promise<TStatus> {
    return (await this.client.devices.getStatus(this.id)) as TStatus;
  }
}

export abstract class Component<TStatus, TDevice extends Device<unknown>> {
  readonly client: SmartThingsClient;
  readonly id: string;
  constructor(readonly device: TDevice, readonly raw: STComponent) {
    this.client = device.client;
    this.id = raw.id!;
  }
  async getStatus(): Promise<TStatus> {
    return ((await this.client.devices.getComponentStatus(
      this.device.id,
      this.id
    )) as unknown) as TStatus;
  }
}

export interface EventDescription<TStatus, TAttributeName extends keyof TStatus> {
  attribute: TAttributeName;
  value: TStatus extends { [key in TAttributeName]: { value: infer TValue } } ? TValue : unknown;
  unit?: string;
  data?: {
    [name: string]: unknown;
  };
}

export abstract class Capability<
  TStatus,
  TComponent extends Component<unknown, TDevice>,
  TDevice extends Device<unknown>
> {
  readonly client: SmartThingsClient;
  readonly device: TDevice;
  readonly id: string;
  constructor(readonly component: TComponent, readonly raw: STCapability) {
    this.client = component.client;
    this.device = component.device;
    this.id = raw.id!;
  }
  async getStatus(): Promise<TStatus> {
    return ((await this.client.devices.getCapabilityStatus(
      this.device.id,
      this.component.id,
      this.id
    )) as unknown) as TStatus;
  }

  async sendEvents<T extends EventDescription<TStatus, keyof TStatus>[]>(
    ...events: T
  ): Promise<TStatus> {
    const decorated = events.map(
      e =>
        ({
          component: this.component.id,
          capability: this.id,
          ...e,
        } as DeviceEvent)
    );
    return ((await this.client.devices.createEvents(
      this.device.id,
      decorated
    )) as unknown) as TStatus;
  }
}

let defaultClient: SmartThingsClient;
export function setDefaultClient(client: SmartThingsClient): void {
  defaultClient = client;
}
export function getDefaultClient(): SmartThingsClient {
  return defaultClient;
}

export type UnknownDevice = Device<unknown>;
export type UnknownComponent = Component<unknown, UnknownDevice>;
export type UnknownCapability = Capability<unknown, UnknownComponent, UnknownDevice>;

export type Components<T extends UnknownDevice> = {
  [K in keyof T]: T[K] extends UnknownComponent ? K : never;
}[keyof T];

export type Capabilities<T extends UnknownComponent> = {
  [K in keyof T]: T[K] extends UnknownCapability ? K : never;
}[keyof T];

export type DeviceCapabilities<T extends UnknownDevice> = {
  [K in Components<T>]: Capabilities<T[K]>;
}[Components<T>];
