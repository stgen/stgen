import moduleAlias from 'module-alias';
moduleAlias.addAlias('stgen', `${__dirname}/../../lib/index`);

import assert from 'assert';
import fs from 'fs';
import { SmartThingsClient, BearerTokenAuthenticator } from '@smartthings/core-sdk';
import { virtualDimmer, virtualSwitch } from '../../gen/devices';

describe('Rich Requests', function () {
    this.timeout(5000);
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
        let newState = await cap.getStatus();
        assert.strictEqual(newState.switch.value, 'on');
        status = await cap.off();
        assert.strictEqual(status.status, 'success');
        newState = await cap.getStatus();
        assert.strictEqual(newState.switch.value, 'off');
    });
    it('Can send a command with parameters', async function() {
        let cap = virtualDimmer(client).main.switchlevel;
        let status = await cap.setlevel(50);
        assert.strictEqual(status.status, 'success');
        let newState = await cap.getStatus();
        assert.strictEqual(newState.level.value, 50);
        status = await cap.setlevel(75);
        assert.strictEqual(status.status, 'success');
        newState = await cap.getStatus();
        assert.strictEqual(newState.level.value, 75);
    });
});