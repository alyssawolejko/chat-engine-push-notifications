/* eslint-disable no-unused-expressions,no-new,no-new-wrappers,no-new-object,no-array-constructor */
/* global test, expect */
import { networkInterfaces } from 'os';
import ChatEngineCore from 'chat-engine';
import { plugin } from '../../src/plugin';

// Retrieve reference on currently used network interface. Address is the same as used to start ChatEngine server.
const networkInterface = [].concat(...Object.values(networkInterfaces())).filter(details => details.family === 'IPv4' && !details.internal).pop();

jest.mock('NativeModules', () => ({
    CENNotifications: {
        receiveMissedEvents: jest.fn(),
        formatNotificationPayload: jest.fn((nativePayload, callback) => callback(nativePayload, false))
    }
}));

describe('integration::ChatEngineCore', () => {
    let chatEngine;

    beforeEach(() => {
        chatEngine = ChatEngineCore.create(
            { publishKey: process.env.PUBLISH_KEY, subscribeKey: process.env.SUBSCRIBE_KEY },
            { endpoint: `http://${networkInterface.address}:3000/insecure`, throwErrors: true }
        );
    });

    test('should provide interface for proto plugins', () => {
        expect(chatEngine.proto).toBeDefined();
    });

    test('should register proto plugin', () => {
        let ignoredChats = ['chat-engine', 'Main', 'Support', 'Docs', 'Foolery'];
        chatEngine.proto('Me', plugin({ events: ['$.invite', 'message'], platforms: { ios: true, android: true }, ignoredChats }));
        expect(chatEngine.protoPlugins.Me.length).toBeGreaterThan(0);
    });
});

describe('integration::ChatEngineNotifications', () => {
    const ignoredChats = ['chat-engine', 'Main', 'Support', 'Docs', 'Foolery'];
    let chatEngine;

    beforeEach(() => {
        chatEngine = ChatEngineCore.create(
            { publishKey: process.env.PUBLISH_KEY, subscribeKey: process.env.SUBSCRIBE_KEY },
            { endpoint: `http://${networkInterface.address}:3000/insecure`, throwErrors: true }
        );
    });

    test('should add \'notifications\' property to Me', (done) => {
        chatEngine.proto('Me', plugin({ events: ['$.invite', 'message'], platforms: { ios: true, android: true }, ignoredChats }));
        chatEngine.on('$.ready', () => {
            expect(chatEngine.me.notifications).toBeDefined();
            jest.clearAllTimers();
            done();
        });
        chatEngine.connect('pubnub', { works: true }, 'pubnub-secret');
    });

    test('should add middleware to Me\'s #write.#direct chat', (done) => {
        chatEngine.proto('Me', plugin({ events: ['$.invite', 'message'], platforms: { ios: true, android: true }, ignoredChats }));
        chatEngine.on('$.ready', () => {
            expect(chatEngine.me.direct.plugins.length).toBeGreaterThan(0);
            jest.clearAllTimers();
            done();
        });
        chatEngine.connect('pubnub', { works: true }, 'pubnub-secret');
    });

    test('should use user-provided formatter with no notification appending ({} returned from formatter)', (done) => {
        const formatter = () => ({});
        chatEngine.proto('Me', plugin({
            events: ['$.invite', 'message'],
            platforms: { ios: true, android: true },
            ignoredChats,
            formatter
        }));
        chatEngine.on('$.ready', () => {
            const messageHandler = (message) => {
                chatEngine.me.direct.off('message', messageHandler);
                expect(message.pn_apns).not.toBeDefined();
                expect(message.pn_gcm).not.toBeDefined();
                jest.clearAllTimers();
                done();
            };
            const connectionHandler = () => {
                chatEngine.me.direct.off('$.connected', connectionHandler);
                chatEngine.me.direct.on('message', messageHandler);
                chatEngine.me.direct.emit('message', { message: 'For chat' });
            };
            chatEngine.me.direct.on('$.connected', connectionHandler);
        });
        chatEngine.connect('pubnub', { works: true }, 'pubnub-secret');
    });

    test('should use user-provided formatter to append push notification to published message', (done) => {
        const formatter = () => ({ apns: { aps: { alert: 'Title from formatted function #1' } } });
        chatEngine.proto('Me', plugin({
            events: ['$.invite', 'message'],
            platforms: { ios: true, android: true },
            ignoredChats,
            formatter
        }));
        chatEngine.on('$.ready', () => {
            const messageHandler = (message) => {
                chatEngine.me.direct.off('message', messageHandler);
                expect(message.pn_apns).toBeDefined();
                expect(message.pn_apns.aps.alert).toEqual(formatter().apns.aps.alert);
                expect(message.pn_apns.cepayload).toBeDefined();
                expect(message.pn_apns.cepayload.event).toBeDefined();
                expect(message.pn_apns.cepayload.category).toBeDefined();
                expect(message.pn_apns.cepayload.chat).toBeDefined();
                expect(message.pn_apns.cepayload.data).toBeDefined();
                expect(message.pn_apns.cepayload.sender).toBeDefined();
                jest.clearAllTimers();
                done();
            };
            const connectionHandler = () => {
                chatEngine.me.direct.off('$.connected', connectionHandler);
                chatEngine.me.direct.on('message', messageHandler);
                chatEngine.me.direct.emit('message', { message: 'For chat' });
            };
            chatEngine.me.direct.on('$.connected', connectionHandler);
        });
        chatEngine.connect('pubnub', { works: true }, 'pubnub-secret');
    });

    test('should use default formatter for $.invite', (done) => {
        chatEngine.proto('Me', plugin({ events: ['$.invite', 'message'], platforms: { ios: true, android: true }, ignoredChats }));
        chatEngine.on('$.ready', () => {
            const chat = new chatEngine.Chat('secret-meeting');
            const invitationHandler = (message) => {
                chatEngine.me.direct.off('$.invite', invitationHandler);
                expect(message.pn_apns).toBeDefined();
                expect(message.pn_apns.aps.category).toBeDefined();
                expect(message.pn_apns.cepayload).toBeDefined();
                expect(message.pn_gcm).toBeDefined();
                expect(message.pn_gcm.data.cepayload).toBeDefined();
                jest.clearAllTimers();
                done();
            };
            const connectionHandler = () => {
                chat.off('$.connected', connectionHandler);
                chatEngine.me.direct.on('$.invite', invitationHandler);
                chat.invite(chatEngine.me);
            };
            chat.on('$.connected', connectionHandler);
        });
        chatEngine.connect('pubnub', { works: true }, 'pubnub-secret');
    });

    test('should send $.notifications.seen event', (done) => {
        const notification = { notification: { aps: { alert: 'PubNub is awesome!' }, cepayload: { ceid: 'unique' } }, foreground: true };
        chatEngine.proto('Me', plugin({ events: ['$.invite', 'message'], platforms: { ios: true, android: true }, ignoredChats }));
        chatEngine.on('$.ready', () => {
            const messageHandler = (message) => {
                chatEngine.me.direct.off('$.notifications.seen', messageHandler);
                expect(message.pn_apns).toBeDefined();
                expect(message.pn_apns.cepayload).toBeDefined();
                expect(message.pn_apns.cepayload.data.ceid).toEqual(notification.notification.cepayload.ceid);
                expect(message.pn_gcm).toBeDefined();
                expect(message.pn_gcm.data.cepayload).toBeDefined();
                expect(message.pn_gcm.data.cepayload.data.ceid).toEqual(notification.notification.cepayload.ceid);
                jest.clearAllTimers();
                done();
            };
            const connectionHandler = () => {
                chatEngine.me.direct.off('$.connected', connectionHandler);
                chatEngine.me.direct.on('$.notifications.seen', messageHandler);
                chatEngine.me.notifications.markNotificationAsSeen(notification);
            };
            if (!chatEngine.me.direct.connected) {
                chatEngine.me.direct.on('$.connected', connectionHandler);
            } else {
                connectionHandler();
            }
        });
        chatEngine.connect('pubnub', { works: true }, 'pubnub-secret');
    });
});
