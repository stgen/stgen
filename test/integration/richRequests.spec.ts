import moduleAlias from 'module-alias';
moduleAlias.addAlias('@stgen/stgen', `${__dirname}/../../lib/index`);

import { BearerTokenAuthenticator, SmartThingsClient } from '@smartthings/core-sdk';
import assert from 'assert';
import fs from 'fs';
import { sleep } from './../../codegen/utils';
import { virtualDimmer, virtualSwitch } from './../../gen/devices';
import { testHome } from './../../gen/locations';
import { turnOffVirtualSwitch, turnOnVirtualSwitch } from './../../gen/scenes';


describe('Rich Requests', function () {
    this.timeout(10000);
    let client: SmartThingsClient;
    before(function () {
        client = new SmartThingsClient(
            new BearerTokenAuthenticator(fs.readFileSync('accessToken', 'utf-8')));
    });
    it('Can get capability status', async function () {
        let status = await virtualSwitch(client).main.switch.getStatus();
        assert(status.switch.value);
    });
    it('Can get component status', async function () {
        let status = await virtualSwitch(client).main.getStatus();
        assert(status.switch.switch.value);
    });
    it('Can get device status', async function () {
        let status = await virtualSwitch(client).getStatus();
        assert(status.components.main.switch.switch.value);
    });
    it('Can send a command with no parameters', async function () {
        let cap = virtualSwitch(client).main.switch;
        let status = await cap.on();
        assert.strictEqual(status.status, 'success');
        await sleep(500);
        let newState = await cap.getStatus();
        assert.strictEqual(newState.switch.value, 'on');
        status = await cap.off();
        assert.strictEqual(status.status, 'success');
        await sleep(500);
        newState = await cap.getStatus();
        assert.strictEqual(newState.switch.value, 'off');
    });
    it('Can send a command with parameters', async function () {
        let cap = virtualDimmer(client).main.switchlevel;
        let status = await cap.setlevel(50);
        assert.strictEqual(status.status, 'success');
        await sleep(500);
        let newState = await cap.getStatus();
        assert.strictEqual(newState.level.value, 50);
        status = await cap.setlevel(75);
        assert.strictEqual(status.status, 'success');
        await sleep(500);
        newState = await cap.getStatus();
        assert.strictEqual(newState.level.value, 75);
    });
    it('Can execute a scene', async function () {
        let onScene = turnOnVirtualSwitch(client);
        let offScene = turnOffVirtualSwitch(client);
        let cap = virtualSwitch(client).main.switch;

        let status = await onScene.execute();
        assert.strictEqual(status.status, 'success');
        await sleep(500);
        let newState = await cap.getStatus();
        assert.strictEqual(newState.switch.value, 'on');
        status = await offScene.execute();
        assert.strictEqual(status.status, 'success');
        await sleep(500);
        newState = await cap.getStatus();
        assert.strictEqual(newState.switch.value, 'off');
    });
    it('Can get access through a location/room', async function () {
        let status = await testHome(client).virtualRoom.virtualSwitch.getStatus();
        assert(status.components.main.switch.switch);
    });
    it('Can get access through a location with no room', async function () {
        let status = await testHome(client).noRoomAssigned.roomlessVirtualSwitch.getStatus();
        assert(status.components.main.switch.switch);
    });
});