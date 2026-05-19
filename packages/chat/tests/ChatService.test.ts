import { EventEmitter } from 'node:events'
import { MessageType, RoomEvent } from '@rtcforge/signaling'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatService } from '../src/ChatService.js'
import { InMemoryMessageStore } from '../src/MessageStore.js'
import { ChatServiceEvent } from '../src/types.js'

class MockPeer extends EventEmitter {
    readonly id: string
    readonly role: string
    send = vi.fn()

    constructor(id: string, role = 'participant') {
        super()
        this.id = id
        this.role = role
    }
}

class MockRoom extends EventEmitter {
    private readonly peers = new Map<string, MockPeer>()
    broadcast = vi.fn()
    broadcastExcept = vi.fn()

    addPeer(peer: MockPeer): void {
        this.peers.set(peer.id, peer)
        this.emit(RoomEvent.PeerJoined, peer)
    }

    removePeer(peer: MockPeer): void {
        this.peers.delete(peer.id)
        this.emit(RoomEvent.PeerLeft, peer)
    }

    getPeers(): IterableIterator<MockPeer> {
        return this.peers.values()
    }

    getPeer(id: string): MockPeer | undefined {
        return this.peers.get(id)
    }
}

describe('ChatService', () => {
    let room: MockRoom
    let chat: ChatService

    beforeEach(() => {
        room = new MockRoom()
        chat = new ChatService(room as never)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('peer chat messages', () => {
        it('broadcasts chat message when a peer sends one', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('chat', 'hello')

            expect(room.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Chat, from: 'p1', text: 'hello' }),
            )
        })

        it('emits message event with ChatMessage shape', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Message, listener)

            peer.emit('chat', 'hi there')

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ from: 'p1', text: 'hi there' }),
            )
            const msg = listener.mock.calls[0][0]
            expect(typeof msg.id).toBe('string')
            expect(typeof msg.ts).toBe('number')
            expect(typeof msg.seq).toBe('number')
        })

        it('wires peers already in the room at construction', () => {
            const peer = new MockPeer('existing')
            room.addPeer(peer)
            const chat2 = new ChatService(room as never)
            const listener = vi.fn()
            chat2.on(ChatServiceEvent.Message, listener)

            peer.emit('chat', 'late wire')

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({ from: 'existing' }))
        })

        it('assigns incrementing sequence numbers', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const msgs: { seq: number }[] = []
            chat.on(ChatServiceEvent.Message, (m) => msgs.push(m))

            peer.emit('chat', 'first')
            peer.emit('chat', 'second')
            peer.emit('chat', 'third')

            expect(msgs[0].seq).toBe(1)
            expect(msgs[1].seq).toBe(2)
            expect(msgs[2].seq).toBe(3)
        })
    })

    describe('typing indicators', () => {
        it('broadcasts typing to all peers except sender', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('typing')

            expect(room.broadcastExcept).toHaveBeenCalledWith('p1', {
                type: MessageType.Typing,
                peerId: 'p1',
            })
        })

        it('emits typing event with peerId', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Typing, listener)

            peer.emit('typing')

            expect(listener).toHaveBeenCalledWith('p1')
        })

        it('debounces repeated typing within the window', () => {
            vi.useFakeTimers()
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('typing')
            peer.emit('typing')
            peer.emit('typing')

            expect(room.broadcastExcept).toHaveBeenCalledTimes(1)
        })

        it('allows another typing broadcast after debounce window expires', () => {
            vi.useFakeTimers()
            const freshRoom = new MockRoom()
            const chat2 = new ChatService(freshRoom as never, { typingDebounceMs: 500 })
            const peer = new MockPeer('p1')
            freshRoom.addPeer(peer)

            peer.emit('typing')
            vi.advanceTimersByTime(600)
            peer.emit('typing')

            expect(freshRoom.broadcastExcept).toHaveBeenCalledTimes(2)
        })

        it('clears typing timer when peer leaves', () => {
            vi.useFakeTimers()
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            peer.emit('typing')

            room.removePeer(peer)
            vi.advanceTimersByTime(5000)

            expect(room.broadcastExcept).toHaveBeenCalledTimes(1)
        })
    })

    describe('server-side send()', () => {
        it('broadcasts message to all peers', () => {
            chat.send({ from: 'system', text: 'Welcome!' })

            expect(room.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: MessageType.Chat,
                    from: 'system',
                    text: 'Welcome!',
                }),
            )
        })

        it('emits message event', () => {
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Message, listener)

            chat.send({ from: 'system', text: 'hello' })

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ from: 'system', text: 'hello' }),
            )
        })
    })

    describe('direct messages', () => {
        it('sends to target peer only, not broadcast', () => {
            const sender = new MockPeer('p1')
            const target = new MockPeer('p2')
            room.addPeer(sender)
            room.addPeer(target)

            sender.emit('chat', 'hey p2', 'p2')

            expect(target.send).toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Chat, text: 'hey p2', to: 'p2' }),
            )
            expect(room.broadcast).not.toHaveBeenCalled()
        })

        it('echoes DM back to sender', () => {
            const sender = new MockPeer('p1')
            const target = new MockPeer('p2')
            room.addPeer(sender)
            room.addPeer(target)

            sender.emit('chat', 'hey p2', 'p2')

            expect(sender.send).toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Chat, text: 'hey p2' }),
            )
        })

        it('calls onOfflineMessage when DM target is not in room', () => {
            const onOfflineMessage = vi.fn()
            const freshRoom = new MockRoom()
            const chat2 = new ChatService(freshRoom as never, { onOfflineMessage })
            const sender = new MockPeer('p1')
            freshRoom.addPeer(sender)

            sender.emit('chat', 'offline dm', 'ghost')

            expect(onOfflineMessage).toHaveBeenCalledWith(
                'ghost',
                expect.objectContaining({ text: 'offline dm' }),
            )
        })

        it('includes replyTo field when set', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Message, listener)

            peer.emit('chat', 'reply text', undefined, 'orig-id')

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'orig-id' }))
        })
    })

    describe('delivery receipts', () => {
        it('sends delivered receipt to sender after broadcast', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('chat', 'hello')

            expect(peer.send).toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Delivered }),
            )
        })

        it('emits delivered event with message id', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Delivered, listener)

            peer.emit('chat', 'hello')

            expect(listener).toHaveBeenCalledWith(expect.any(String))
        })

        it('does not send delivery receipt for server-side send()', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            chat.send({ from: 'system', text: 'hi' })

            expect(peer.send).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Delivered }),
            )
        })
    })

    describe('message history', () => {
        it('sends stored history to a newly joining peer', () => {
            const store = new InMemoryMessageStore()
            const freshRoom = new MockRoom()
            const chat2 = new ChatService(freshRoom as never, { store })

            const p1 = new MockPeer('p1')
            freshRoom.addPeer(p1)
            p1.emit('chat', 'message one')
            p1.emit('chat', 'message two')

            const p2 = new MockPeer('p2')
            freshRoom.addPeer(p2)

            expect(p2.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: MessageType.History,
                    messages: expect.arrayContaining([
                        expect.objectContaining({ text: 'message one' }),
                        expect.objectContaining({ text: 'message two' }),
                    ]),
                }),
            )
        })

        it('does not send history message when store is empty', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            expect(peer.send).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.History }),
            )
        })
    })

    describe('read receipts', () => {
        it('sends read receipt to original sender', () => {
            const sender = new MockPeer('p1')
            const reader = new MockPeer('p2')
            room.addPeer(sender)
            room.addPeer(reader)

            sender.emit('chat', 'a message')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id

            reader.emit('read', msgId)

            expect(sender.send).toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Read, id: msgId, by: 'p2' }),
            )
        })

        it('emits read event', () => {
            const sender = new MockPeer('p1')
            const reader = new MockPeer('p2')
            room.addPeer(sender)
            room.addPeer(reader)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Read, listener)

            sender.emit('chat', 'a message')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id
            reader.emit('read', msgId)

            expect(listener).toHaveBeenCalledWith(msgId, 'p2')
        })

        it('ignores read for unknown message id', () => {
            const sender = new MockPeer('p1')
            const reader = new MockPeer('p2')
            room.addPeer(sender)
            room.addPeer(reader)

            reader.emit('read', 'no-such-id')

            expect(sender.send).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Read }),
            )
        })
    })

    describe('edit', () => {
        it('broadcasts edited message', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('chat', 'original')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id

            peer.emit('edit', msgId, 'updated text')

            expect(room.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: MessageType.Edited,
                    id: msgId,
                    text: 'updated text',
                    by: 'p1',
                }),
            )
        })

        it('emits edited event', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Edited, listener)

            peer.emit('chat', 'original')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id
            peer.emit('edit', msgId, 'updated')

            expect(listener).toHaveBeenCalledWith(msgId, 'updated', expect.any(Number), 'p1')
        })

        it('ignores edit from a peer who did not send the message', () => {
            const author = new MockPeer('p1')
            const other = new MockPeer('p2')
            room.addPeer(author)
            room.addPeer(other)

            author.emit('chat', 'original')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id
            room.broadcast.mockClear()

            other.emit('edit', msgId, 'hijack')

            expect(room.broadcast).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Edited }),
            )
        })
    })

    describe('delete', () => {
        it('broadcasts deleted message', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('chat', 'to be deleted')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id

            peer.emit('delete', msgId)

            expect(room.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Deleted, id: msgId, by: 'p1' }),
            )
        })

        it('emits deleted event', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Deleted, listener)

            peer.emit('chat', 'bye')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id
            peer.emit('delete', msgId)

            expect(listener).toHaveBeenCalledWith(msgId, 'p1')
        })

        it('ignores delete from non-author', () => {
            const author = new MockPeer('p1')
            const other = new MockPeer('p2')
            room.addPeer(author)
            room.addPeer(other)

            author.emit('chat', 'mine')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id
            room.broadcast.mockClear()

            other.emit('delete', msgId)

            expect(room.broadcast).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Deleted }),
            )
        })
    })

    describe('reactions', () => {
        it('broadcasts reaction to room', () => {
            const author = new MockPeer('p1')
            const reactor = new MockPeer('p2')
            room.addPeer(author)
            room.addPeer(reactor)

            author.emit('chat', 'nice post')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id

            reactor.emit('reaction', msgId, '👍')

            expect(room.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: MessageType.Reaction,
                    msgId,
                    emoji: '👍',
                    by: 'p2',
                }),
            )
        })

        it('emits reaction event', () => {
            const author = new MockPeer('p1')
            const reactor = new MockPeer('p2')
            room.addPeer(author)
            room.addPeer(reactor)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Reaction, listener)

            author.emit('chat', 'nice post')
            const msgId = (room.broadcast.mock.calls[0][0] as { id: string }).id
            reactor.emit('reaction', msgId, '❤️')

            expect(listener).toHaveBeenCalledWith(msgId, '❤️', 'p2')
        })

        it('ignores reaction to unknown message', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            room.broadcast.mockClear()

            peer.emit('reaction', 'no-such-msg', '👍')

            expect(room.broadcast).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: MessageType.Reaction }),
            )
        })
    })

    describe('multimedia attachments', () => {
        const attachment = {
            url: 'https://cdn.example.com/img.jpg',
            mimeType: 'image/jpeg',
            size: 204800,
        }

        it('broadcasts attachment-only message', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('chat', undefined, undefined, undefined, [attachment])

            expect(room.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: MessageType.Chat,
                    from: 'p1',
                    attachments: [attachment],
                }),
            )
        })

        it('broadcasts text + attachment together', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)

            peer.emit('chat', 'look at this', undefined, undefined, [attachment])

            expect(room.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: MessageType.Chat,
                    text: 'look at this',
                    attachments: [attachment],
                }),
            )
        })

        it('emits message event with attachment', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const listener = vi.fn()
            chat.on(ChatServiceEvent.Message, listener)

            peer.emit('chat', undefined, undefined, undefined, [attachment])

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ attachments: [attachment] }),
            )
        })

        it('emits error and does not broadcast when message has no text and no attachments', () => {
            const peer = new MockPeer('p1')
            room.addPeer(peer)
            const errorListener = vi.fn()
            chat.on(ChatServiceEvent.Error, errorListener)

            peer.emit('chat', undefined)

            expect(room.broadcast).not.toHaveBeenCalled()
            expect(errorListener).toHaveBeenCalledWith(expect.any(Error))
        })

        it('stores attachment metadata in message store for history', () => {
            const store = new InMemoryMessageStore()
            const freshRoom = new MockRoom()
            const chat2 = new ChatService(freshRoom as never, { store })
            const p1 = new MockPeer('p1')
            freshRoom.addPeer(p1)

            p1.emit('chat', undefined, undefined, undefined, [attachment])

            const p2 = new MockPeer('p2')
            freshRoom.addPeer(p2)

            expect(p2.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: MessageType.History,
                    messages: expect.arrayContaining([
                        expect.objectContaining({ attachments: [attachment] }),
                    ]),
                }),
            )
        })
    })

    describe('role-based send permission', () => {
        it('allows permitted role to send', () => {
            const freshRoom = new MockRoom()
            const chat2 = new ChatService(freshRoom as never, {
                sendRoles: ['host', 'participant'],
            })
            const peer = new MockPeer('p1', 'participant')
            freshRoom.addPeer(peer)

            peer.emit('chat', 'allowed')

            expect(freshRoom.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({ text: 'allowed' }),
            )
        })

        it('blocks unpermitted role from sending', () => {
            const freshRoom = new MockRoom()
            const chat2 = new ChatService(freshRoom as never, { sendRoles: ['host'] })
            const viewer = new MockPeer('v1', 'viewer')
            freshRoom.addPeer(viewer)

            viewer.emit('chat', 'should not send')

            expect(freshRoom.broadcast).not.toHaveBeenCalledWith(
                expect.objectContaining({ text: 'should not send' }),
            )
        })

        it('viewer can still send typing even when not in sendRoles', () => {
            const freshRoom = new MockRoom()
            const chat2 = new ChatService(freshRoom as never, { sendRoles: ['host'] })
            const viewer = new MockPeer('v1', 'viewer')
            freshRoom.addPeer(viewer)

            viewer.emit('typing')

            expect(freshRoom.broadcastExcept).toHaveBeenCalledWith('v1', {
                type: MessageType.Typing,
                peerId: 'v1',
            })
        })
    })
})
