import { SmartThingsClient, Location as STLocation, Room as STRoom } from '@smartthings/core-sdk';

export class Location {
  readonly id: string;
  constructor(readonly client: SmartThingsClient, readonly raw: STLocation) {
    this.id = raw.locationId;
  }
}

export class Room<TLocation extends Location> {
  readonly id: string;
  readonly client: SmartThingsClient;
  constructor(readonly location: TLocation, readonly raw: STRoom) {
    this.client = location.client;
    this.id = raw.roomId!;
  }
}
