import { SceneSummary, SmartThingsClient, Status } from '@smartthings/core-sdk';

export class Scene {
  readonly id: string;
  constructor(readonly client: SmartThingsClient, readonly raw: SceneSummary) {
    this.id = raw.sceneId!;
  }

  execute(): Promise<Status> {
    return this.client.scenes.execute(this.id);
  }
}
