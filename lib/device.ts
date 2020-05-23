import { Device as STDevice, Component as STComponent, Capability as STCapability, SmartThingsClient } from "@smartthings/core-sdk"

export class Device<TStatus> {
    readonly id: string;
    constructor(readonly client: SmartThingsClient, readonly raw: STDevice) {
        this.id = raw.deviceId!;
    }
    async getStatus(): Promise<TStatus> {
        return await this.client.devices.getStatus(this.id) as TStatus;
    }
}

export abstract class Component<TStatus extends object, TDevice extends Device<any>> {
    readonly client: SmartThingsClient;
    readonly id: string;
    constructor(readonly device: TDevice, readonly raw: STComponent) {
        this.client = device.client;
        this.id = raw.id!;
    }
    async getStatus(): Promise<TStatus> {
        return await this.client.devices.getComponentStatus(this.device.id, this.id) as TStatus
    }
}

export abstract class Capability<TStatus extends object, TComponent extends Component<any, TDevice>, TDevice extends Device<any>> {
    readonly client: SmartThingsClient;
    readonly device: TDevice;
    readonly id: string;
    constructor(readonly component: TComponent, readonly raw: STCapability) {
        this.client = component.client;
        this.device = component.device;
        this.id = raw.id!;
    }
    async getStatus(): Promise<TStatus> {
        return await this.client.devices.getCapabilityStatus(
            this.device.id, this.component.id, this.id) as TStatus;
    }
}

let defaultClient: SmartThingsClient;
export function setDefaultClient(client: SmartThingsClient) {
    defaultClient = client;
}
export function getDefaultClient(): SmartThingsClient {
    return defaultClient;
}