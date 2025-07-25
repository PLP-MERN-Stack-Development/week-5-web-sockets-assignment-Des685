// real-time-chat-app/server/server.js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*", // Keep for development debugging
        methods: ["GET", "POST"]
    }
});

app.use(cors());

const PORT = process.env.PORT || 5000;

// --- In-memory storage for multi-room functionality ---
// Maps socket.id to user info { username, currentRoom }
const onlineUsers = {};
// Stores messages per room: { 'roomName': [{ messageObject }, ...] }
const messagesByRoom = {
    'general': [],
    'random': [],
    'tech': [], // Example: Add more default rooms
    'sports': []
};
// Stores typing users per room: { 'roomName': ['user1', 'user2'] }
const typingUsersByRoom = {
    'general': [],
    'random': [],
    'tech': [],
    'sports': []
};

// Helper function to get the list of current online usernames in a specific room
const getOnlineUsernamesInRoom = (roomName) => {
    return Object.values(onlineUsers)
                 .filter(user => user.currentRoom === roomName)
                 .map(user => user.username);
};

app.get('/', (req, res) => {
    res.send('Chat server is running!');
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send available rooms to the newly connected client
    socket.emit('available_rooms', Object.keys(messagesByRoom));

    // Event to handle a user joining a specific room
    socket.on('join_room', ({ username, room }) => {
        // Store user's previous room to clean up
        const previousUserInfo = onlineUsers[socket.id];
        const previousRoom = previousUserInfo ? previousUserInfo.currentRoom : null;

        // If user was in a previous room, make them leave it
        if (previousRoom && previousRoom !== room) {
            socket.leave(previousRoom);
            console.log(`${username} (${socket.id}) left room: ${previousRoom}`);

            // Notify old room that user left
            io.to(previousRoom).emit('user_left_notification_in_room', {
                username: previousUserInfo.username,
                room: previousRoom
            });
            // Update online users list for the old room
            io.to(previousRoom).emit('online_users_update_in_room', {
                room: previousRoom,
                users: getOnlineUsernamesInRoom(previousRoom)
            });
            // Clean up typing status in old room
            if (typingUsersByRoom[previousRoom]) {
                typingUsersByRoom[previousRoom] = typingUsersByRoom[previousRoom].filter(u => u !== username);
                io.to(previousRoom).emit('user_typing_update_in_room', { room: previousRoom, users: typingUsersByRoom[previousRoom] });
            }
        }

        // Join the new room
        socket.join(room);
        onlineUsers[socket.id] = { username, currentRoom: room };
        console.log(`${username} (${socket.id}) joined room: ${room}`);

        // Send initial messages for the new room to the joining client
        socket.emit('initial_messages_in_room', { room, messages: messagesByRoom[room] || [] });

        // Update online users for the new room to everyone in that room
        io.to(room).emit('online_users_update_in_room', {
            room,
            users: getOnlineUsernamesInRoom(room)
        });

        // Notify new room that user joined (broadcast to others in the room)
        socket.to(room).emit('user_joined_notification_in_room', {
            username,
            room
        });
    });

    // Handle sending messages (room-specific)
    socket.on('send_message', (data) => {
        const { username, message, room } = data;
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const fullMessage = { username, message, room, timestamp, id: socket.id };

        if (!messagesByRoom[room]) {
            messagesByRoom[room] = []; // Create room's message array if it doesn't exist
        }
        messagesByRoom[room].push(fullMessage);
        console.log(`Message from ${username} in room '${room}': ${message}`);

        // Emit the message to all clients in that specific room
        io.to(room).emit('receive_message', fullMessage);

        // Emit a 'new_message_in_room' event for unread counts (to all clients, except sender)
        // This is caught by clients not currently in 'room' to update unread counts
        socket.broadcast.emit('new_message_in_room', { room, message: fullMessage });
    });

    // Typing Indicators (room-specific)
    socket.on('typing', ({ username, room }) => {
        if (!typingUsersByRoom[room]) {
            typingUsersByRoom[room] = [];
        }
        // Add user to typing list for their current room if not already there
        if (!typingUsersByRoom[room].includes(username)) {
            typingUsersByRoom[room].push(username);
        }
        // Broadcast to everyone in that room EXCEPT the user who is typing
        socket.to(room).emit('user_typing_update_in_room', { room, users: typingUsersByRoom[room] });
    });

    socket.on('stop_typing', ({ username, room }) => {
        if (typingUsersByRoom[room]) {
            // Remove user from typing list for their current room
            const index = typingUsersByRoom[room].indexOf(username);
            if (index > -1) {
                typingUsersByRoom[room].splice(index, 1);
            }
        }
        // Broadcast to everyone in that room EXCEPT the user who stopped typing
        socket.to(room).emit('user_typing_update_in_room', { room, users: typingUsersByRoom[room] });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const disconnectedUserInfo = onlineUsers[socket.id];
        console.log(`User disconnected: ${socket.id} (Username: ${disconnectedUserInfo ? disconnectedUserInfo.username : 'N/A'})`);

        if (disconnectedUserInfo) {
            delete onlineUsers[socket.id]; // Remove from online users list

            const { username, currentRoom } = disconnectedUserInfo;

            // Notify the room the user was in that they left
            if (currentRoom) {
                 io.to(currentRoom).emit('user_left_notification_in_room', {
                    username,
                    room: currentRoom
                });
                // Update online users list for that room
                io.to(currentRoom).emit('online_users_update_in_room', {
                    room: currentRoom,
                    users: getOnlineUsernamesInRoom(currentRoom)
                });
                // Clean up typing status in that room
                if (typingUsersByRoom[currentRoom]) {
                    typingUsersByRoom[currentRoom] = typingUsersByRoom[currentRoom].filter(u => u !== username);
                    io.to(currentRoom).emit('user_typing_update_in_room', { room: currentRoom, users: typingUsersByRoom[currentRoom] });
                }
            }
        }
    });
});

httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`Server listening on port ${PORT}`);
});