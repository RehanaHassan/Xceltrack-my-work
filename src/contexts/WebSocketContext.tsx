import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface CollaborativeUser {
    socketId: string;
    userId: string;
    userName: string;
    color: string;
}

interface CursorPosition {
    socketId: string;
    position: {
        row: number;
        col: number;
        worksheetId: string;
    };
}

interface CellEdit {
    socketId: string;
    cellData: {
        row: number;
        col: number;
        value: string;
        formula?: string;
        worksheetId: string;
    };
}

interface WebSocketContextType {
    socket: Socket | null;
    isConnected: boolean;
    activeUsers: CollaborativeUser[];
    cursors: Map<string, CursorPosition>;
    joinWorkbook: (workbookId: number, userId: string, userName: string) => void;
    leaveWorkbook: (workbookId: number, userId: string) => void;
    sendCursorMove: (workbookId: number, position: { row: number; col: number; worksheetId: string }) => void;
    sendCellEdit: (workbookId: number, cellData: any) => void;
    onCellChange: (callback: (data: CellEdit) => void) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const useWebSocket = () => {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error('useWebSocket must be used within WebSocketProvider');
    }
    return context;
};

interface WebSocketProviderProps {
    children: React.ReactNode;
    serverUrl?: string;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
    children,
    serverUrl = 'http://localhost:5000',
}) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [activeUsers, setActiveUsers] = useState<CollaborativeUser[]>([]);
    const [cursors, setCursors] = useState<Map<string, CursorPosition>>(new Map());
    const cellChangeCallbackRef = useRef<((data: CellEdit) => void) | null>(null);

    useEffect(() => {
        // Initialize socket connection
        const newSocket = io(serverUrl);

        newSocket.on('connect', () => {
            console.log('WebSocket connected');
            setIsConnected(true);
        });

        newSocket.on('disconnect', () => {
            console.log('WebSocket disconnected');
            setIsConnected(false);
        });

        // Listen for user events
        newSocket.on('user-joined', (user: CollaborativeUser) => {
            console.log('User joined:', user);
            setActiveUsers((prev) => [...prev, user]);
        });

        newSocket.on('user-left', ({ socketId, userId }: { socketId: string; userId: string }) => {
            console.log('User left:', userId);
            setActiveUsers((prev) => prev.filter((u) => u.socketId !== socketId));
            setCursors((prev) => {
                const newCursors = new Map(prev);
                newCursors.delete(socketId);
                return newCursors;
            });
        });

        newSocket.on('current-users', (users: CollaborativeUser[]) => {
            console.log('Current users:', users);
            setActiveUsers(users.filter((u) => u.socketId !== newSocket.id));
        });

        // Listen for cursor updates
        newSocket.on('cursor-update', (data: CursorPosition) => {
            setCursors((prev) => {
                const newCursors = new Map(prev);
                newCursors.set(data.socketId, data);
                return newCursors;
            });
        });

        // Listen for cell changes
        newSocket.on('cell-changed', (data: CellEdit) => {
            console.log('Cell changed by another user:', data);
            if (cellChangeCallbackRef.current) {
                cellChangeCallbackRef.current(data);
            }
        });

        setSocket(newSocket);

        return () => {
            newSocket.close();
        };
    }, [serverUrl]);

    const joinWorkbook = React.useCallback((workbookId: number, userId: string, userName: string) => {
        if (socket) {
            socket.emit('join-workbook', { workbookId, userId, userName });
        }
    }, [socket]);

    const leaveWorkbook = React.useCallback((workbookId: number, userId: string) => {
        if (socket) {
            socket.emit('leave-workbook', { workbookId, userId });
        }
    }, [socket]);

    const sendCursorMove = React.useCallback((workbookId: number, position: { row: number; col: number; worksheetId: string }) => {
        if (socket) {
            socket.emit('cursor-move', { workbookId, position });
        }
    }, [socket]);

    const sendCellEdit = React.useCallback((workbookId: number, cellData: any) => {
        if (socket) {
            socket.emit('cell-edit', { workbookId, cellData });
        }
    }, [socket]);

    const onCellChange = React.useCallback((callback: (data: CellEdit) => void) => {
        cellChangeCallbackRef.current = callback;
    }, []);

    return (
        <WebSocketContext.Provider
            value={{
                socket,
                isConnected,
                activeUsers,
                cursors,
                joinWorkbook,
                leaveWorkbook,
                sendCursorMove,
                sendCellEdit,
                onCellChange,
            }}
        >
            {children}
        </WebSocketContext.Provider>
    );
};
