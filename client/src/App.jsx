// real-time-chat-app/client/src/App.jsx
import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_SERVER_URL = "http://127.0.0.1:5000";

function App() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  
  // States for Task 4: Rooms
  const [currentRoom, setCurrentRoom] = useState('general'); // Default room on join
  const [availableRooms, setAvailableRooms] = useState(['general', 'random', 'tech', 'sports']); // Initial default rooms
  const [messagesByRoom, setMessagesByRoom] = useState({
      'general': [],
      'random': [],
      'tech': [],
      'sports': []
  }); // Stores messages for all rooms
  const [unreadCounts, setUnreadCounts] = useState({}); // { roomName: count }

  // Shared states for current room display
  const [displayedMessages, setDisplayedMessages] = useState([]); // Messages for the currentRoom
  const [onlineUsers, setOnlineUsers] = useState([]); // Online users in currentRoom
  const [typingUsers, setTypingUsers] = useState([]); // Typing users in currentRoom

  const [hasJoinedChat, setHasJoinedChat] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // --- Core Socket.IO connection management (runs once on mount) ---
  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to Socket.IO server!');
      setIsConnected(true);
      // If user had previously joined, re-emit join_room for their current room
      if (username && hasJoinedChat) {
         newSocket.emit('join_room', { username, room: currentRoom });
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from Socket.IO server.');
      setIsConnected(false);
      // Clear data on disconnect if user was logged in
      if (hasJoinedChat) {
        setHasJoinedChat(false);
        setUsername('');
      }
      setMessagesByRoom({}); // Clear all messages
      setDisplayedMessages([]);
      setOnlineUsers([]);
      setTypingUsers([]);
      setUnreadCounts({}); // Clear unread counts
      // Reset to default room after disconnect
      setCurrentRoom('general');
    });

    // --- Task 4 Event Listeners (Room-specific) ---

    // Server sends available rooms (e.g., on initial connect)
    newSocket.on('available_rooms', (rooms) => {
      setAvailableRooms(rooms);
      // Initialize unread counts for all known rooms
      const initialUnread = {};
      rooms.forEach(room => {
          initialUnread[room] = 0;
      });
      setUnreadCounts(prev => ({ ...initialUnread, ...prev }));
    });

    // Server sends initial messages for a room when client joins it
    newSocket.on('initial_messages_in_room', ({ room, messages }) => {
      setMessagesByRoom(prev => ({ ...prev, [room]: messages }));
    });

    // Server sends a message for a room
    newSocket.on('receive_message', (msg) => {
      setMessagesByRoom(prev => ({
          ...prev,
          [msg.room]: [...(prev[msg.room] || []), msg]
      }));

      // If the message is for a room not currently viewed, increment unread count
      if (msg.room !== currentRoom) {
          setUnreadCounts(prev => ({
              ...prev,
              [msg.room]: (prev[msg.room] || 0) + 1
          }));
      }
    });

    // Server updates online users for a specific room
    newSocket.on('online_users_update_in_room', ({ room, users }) => {
      if (room === currentRoom) { // Only update if it's the current active room
          setOnlineUsers(users);
      }
    });

    // Server updates typing users for a specific room
    newSocket.on('user_typing_update_in_room', ({ room, users }) => {
      if (room === currentRoom) { // Only update if it's the current active room
          setTypingUsers(users);
      }
    });

    // Server notifies about a new message in any room (for unread counts)
    newSocket.on('new_message_in_room', ({ room }) => { // message data might be included but not always necessary for just count
        if (room !== currentRoom) {
            setUnreadCounts(prev => ({
                ...prev,
                [room]: (prev[room] || 0) + 1
            }));
        }
    });

    // Room-specific notifications for user join/leave
    newSocket.on('user_joined_notification_in_room', ({username: joinedUsername, room: joinedRoom}) => {
        if (joinedRoom === currentRoom) { // Only show notification if in that room
            setDisplayedMessages((prevMessages) => [...prevMessages, {
                username: 'System',
                message: `${joinedUsername} has joined ${joinedRoom}.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isNotification: true
            }]);
        }
    });

    newSocket.on('user_left_notification_in_room', ({username: leftUsername, room: leftRoom}) => {
        if (leftRoom === currentRoom) { // Only show notification if in that room
            setDisplayedMessages((prevMessages) => [...prevMessages, {
                username: 'System',
                message: `${leftUsername} has left ${leftRoom}.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isNotification: true
            }]);
        }
    });

    return () => {
      newSocket.disconnect();
    };
  }, []); // Empty dependency array: runs only ONCE on mount

  // Effect to update displayed messages and reset unread count when currentRoom changes
  useEffect(() => {
    // Update displayed messages to reflect the selected room's messages
    setDisplayedMessages(messagesByRoom[currentRoom] || []);
    // Reset unread count for the newly entered room
    setUnreadCounts(prev => ({ ...prev, [currentRoom]: 0 }));
    // Tell server to switch room for this socket
    if (socket && username && hasJoinedChat) { // Ensure user has already logged in
        socket.emit('join_room', { username, room: currentRoom });
    }
    // Clear typing indicators when switching rooms
    setTypingUsers([]);
    // Note: onlineUsers will be updated by 'online_users_update_in_room' event from server
  }, [currentRoom, messagesByRoom, socket, username, hasJoinedChat]); // Dependencies for this effect

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayedMessages]); // Watch displayedMessages for scrolling

  // Handle joining the chat (initial username input)
  const handleJoinChat = () => {
    if (username.trim() && socket && isConnected) {
      setHasJoinedChat(true);
      // Automatically join the default room ('general') after login
      socket.emit('join_room', { username: username.trim(), room: currentRoom });
    } else {
      alert('Please enter a username to join the chat.');
    }
  };

  // Handle room selection change
  const handleRoomChange = (e) => {
    const newRoom = e.target.value;
    setCurrentRoom(newRoom);
  };

  // Handle sending messages (room-specific)
  const sendMessage = () => {
    if (socket && isConnected && message.trim() && username.trim()) {
      socket.emit('send_message', { username: username.trim(), message: message.trim(), room: currentRoom });
      setMessage(''); // Clear input after sending
      // Also, stop typing for yourself instantly after sending
      socket.emit('stop_typing', { username: username.trim(), room: currentRoom });
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    }
  };

  // Handle typing indicator (room-specific)
  const handleTyping = (e) => {
    setMessage(e.target.value);
    if (socket && isConnected && username.trim()) {
      socket.emit('typing', { username: username.trim(), room: currentRoom });

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('stop_typing', { username: username.trim(), room: currentRoom });
      }, 1500);
    }
  };

  // --- Basic Styling (kept minimal for functionality focus) ---
  const appStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'Arial, sans-serif',
    backgroundColor: '#f0f2f5',
  };

  const headerStyle = {
    backgroundColor: '#007bff',
    color: 'white',
    padding: '10px 20px',
    textAlign: 'center',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const mainContentStyle = {
    display: 'flex',
    flex: 1,
    padding: '10px',
  };

  const chatContainerStyle = {
    flex: 3,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    marginRight: '10px',
    overflow: 'hidden',
  };

  const messagesBoxStyle = {
    flex: 1,
    padding: '15px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  };

  const messageBubbleStyle = {
    maxWidth: '70%',
    padding: '10px 12px',
    borderRadius: '18px',
    wordWrap: 'break-word',
    fontSize: '0.95em',
    lineHeight: '1.4',
  };

  const myMessageStyle = {
    ...messageBubbleStyle,
    alignSelf: 'flex-end',
    backgroundColor: '#DCF8C6', // Light green
  };

  const otherMessageStyle = {
    ...messageBubbleStyle,
    alignSelf: 'flex-start',
    backgroundColor: '#EAEAEA', // Light grey
  };

  const notificationMessageStyle = {
    ...messageBubbleStyle,
    alignSelf: 'center',
    backgroundColor: '#FFEBEE', // Light red for notifications
    fontSize: '0.85em',
    color: '#888',
    textAlign: 'center',
    margin: '5px auto',
  };

  const messageMetaStyle = {
    fontSize: '0.75em',
    color: '#666',
    marginTop: '5px',
    marginBottom: '2px',
    textAlign: 'left'
  };

  const myMessageMetaStyle = {
    ...messageMetaStyle,
    textAlign: 'right',
  };

  const inputAreaStyle = {
    display: 'flex',
    padding: '15px',
    borderTop: '1px solid #eee',
  };

  const messageInputStyle = {
    flex: 1,
    padding: '10px 15px',
    borderRadius: '20px',
    border: '1px solid #ddd',
    marginRight: '10px',
    fontSize: '1em',
  };

  const sendButtonStyle = {
    padding: '10px 20px',
    backgroundColor: '#28a745', // Green
    color: 'white',
    border: 'none',
    borderRadius: '20px',
    cursor: 'pointer',
    fontSize: '1em',
    fontWeight: 'bold',
  };

  const sidebarStyle = {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    padding: '15px',
    display: 'flex',
    flexDirection: 'column',
  };

  const roomListStyle = { // New style for room selection
    marginBottom: '20px',
    paddingBottom: '15px',
    borderBottom: '1px solid #eee',
  };

  const roomSelectStyle = {
    width: '100%',
    padding: '8px',
    borderRadius: '5px',
    border: '1px solid #ccc',
    fontSize: '1em',
    appearance: 'none', // Remove default dropdown arrow
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23333'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    backgroundSize: '16px',
  };

  const roomOptionStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '5px 0',
  };

  const unreadBadgeStyle = {
    backgroundColor: '#ffc107', // Amber for unread
    color: 'white',
    borderRadius: '50%',
    padding: '3px 8px',
    fontSize: '0.7em',
    fontWeight: 'bold',
    marginLeft: '10px',
  };


  const onlineUsersListStyle = {
    flex: 1,
    overflowY: 'auto',
    listStyle: 'none',
    padding: '0',
    margin: '0',
  };

  const typingIndicatorStyle = {
    fontSize: '0.9em',
    color: '#666',
    fontStyle: 'italic',
    minHeight: '20px',
    paddingLeft: '15px',
  };

  const usernameInputContainerStyle = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    flexDirection: 'column',
    gap: '20px',
    backgroundColor: '#e9ecef',
  };

  const usernameInputFieldStyle = {
    padding: '12px 15px',
    borderRadius: '25px',
    border: '1px solid #ccc',
    fontSize: '1.1em',
    width: '300px',
    maxWidth: '80%',
  };

  const joinButtonStyle = {
    padding: '12px 30px',
    borderRadius: '25px',
    border: 'none',
    backgroundColor: '#007bff',
    color: 'white',
    fontSize: '1.1em',
    cursor: 'pointer',
    fontWeight: 'bold',
  };

  // --- Conditional Rendering for Initial Join Screen / Chat Screen ---
  if (!isConnected) {
    return (
      <div style={usernameInputContainerStyle}>
        <h2>Connecting to Chat Server...</h2>
        <p>Please ensure your backend server is running on {SOCKET_SERVER_URL}.</p>
      </div>
    );
  }

  if (!hasJoinedChat) {
    return (
      <div style={usernameInputContainerStyle}>
        <h2>Enter Your Username to Join Chat</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleJoinChat();
          }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}
        >
          <input
            type="text"
            placeholder="Choose a username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={usernameInputFieldStyle}
          />
          <button type="submit" style={joinButtonStyle}>Join Chat</button>
        </form>
      </div>
    );
  }

  // --- Main Chat UI (after joining) ---
  return (
    <div style={appStyle}>
      <header style={headerStyle}>
        <h2>Room: {currentRoom.charAt(0).toUpperCase() + currentRoom.slice(1)}</h2>
        <p>Logged in as: <strong>{username}</strong></p>
      </header>
      <div style={mainContentStyle}>
        <div style={chatContainerStyle}>
          <div style={messagesBoxStyle}>
            {displayedMessages.map((msg, index) => (
              <div
                key={index}
                style={
                  msg.isNotification
                    ? notificationMessageStyle
                    : msg.username === username
                    ? myMessageStyle
                    : otherMessageStyle
                }
              >
                {!msg.isNotification && (
                  <div style={msg.username === username ? myMessageMetaStyle : messageMetaStyle}>
                    <strong>{msg.username}</strong> <small>({msg.timestamp})</small>
                  </div>
                )}
                <div>{msg.message}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div style={typingIndicatorStyle}>
            {typingUsers.filter(u => u !== username).length > 0 && (
              `${typingUsers.filter(u => u !== username).join(', ')} ${typingUsers.filter(u => u !== username).length > 1 ? 'are' : 'is'} typing...`
            )}
          </div>

          <div style={inputAreaStyle}>
            <input
              type="text"
              placeholder="Type a message..."
              value={message}
              onChange={handleTyping}
              onKeyPress={(e) => { if (e.key === 'Enter') sendMessage(); }}
              style={messageInputStyle}
            />
            <button onClick={sendMessage} style={sendButtonStyle}>Send</button>
          </div>
        </div>
        <div style={sidebarStyle}>
            <div style={roomListStyle}>
                <h3>Rooms</h3>
                <select value={currentRoom} onChange={handleRoomChange} style={roomSelectStyle}>
                    {availableRooms.map((room) => (
                        <option key={room} value={room}>
                            {room.charAt(0).toUpperCase() + room.slice(1)}
                            {unreadCounts[room] > 0 && (
                                <span style={unreadBadgeStyle}>{unreadCounts[room]}</span>
                            )}
                        </option>
                    ))}
                </select>
            </div>
            <h3>Online Users ({onlineUsers.length})</h3>
            <ul style={onlineUsersListStyle}>
                {onlineUsers.map((user, index) => (
                    <li key={index} style={{ marginBottom: '5px', color: '#333' }}>
                        {user === username ? (<strong>{user} (You)</strong>) : user}
                    </li>
                ))}
            </ul>
        </div>
      </div>
    </div>
  );
}

export default App;