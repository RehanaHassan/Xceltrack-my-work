import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ExcelEditor, { ExcelEditorRef } from '../components/ExcelEditor';
import EditorToolbar from '../components/EditorToolbar';
import FormulaBar from '../components/FormulaBar';
import ZoomControls from '../components/ZoomControls';
import WorksheetTabs from '../components/WorksheetTabs';
import FileUploadModal from '../components/FileUploadModal';
import CollaborativeCursors from '../components/CollaborativeCursors';
import WhosEditingSidebar from '../components/WhosEditingSidebar';
import VersionHistoryTimeline from '../components/VersionHistoryTimeline';
import RollbackModal from '../components/RollbackModal';
import { FiChevronLeft, FiChevronRight, FiMenu, FiSidebar } from 'react-icons/fi';
import { Commit } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { uploadWorkbook, getWorkbookData, createCommit } from '../services/api';

const Editor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editorRef = React.useRef<ExcelEditorRef>(null);
  const { user } = useAuth();
  const { showToast } = useToast();
  const { joinWorkbook, leaveWorkbook, sendCursorMove, sendCellEdit, activeUsers, cursors, onCellChange } = useWebSocket();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [workbookData, setWorkbookData] = useState<any>(null);
  const [selectedCell, setSelectedCell] = useState('A1');
  const [cellFormula, setCellFormula] = useState('');
  const [zoom, setZoom] = useState(100);
  const [worksheets, setWorksheets] = useState([
    { id: 'sheet-01', name: 'Sheet1', position: 0 },
  ]);
  const [activeWorksheetId, setActiveWorksheetId] = useState('sheet-01');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(true);
  const [selectedCommitForRollback, setSelectedCommitForRollback] = useState<Commit | null>(null);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Fetch workbook data when ID changes
  useEffect(() => {
    const fetchWorkbook = async () => {
      if (!id) return;
      try {
        console.log('Fetching workbook:', id);
        const data = await getWorkbookData(id);
        console.log('Workbook loaded:', data);
        setWorkbookData(data);
        // Update worksheets state from loaded data if needed
        if (data.sheets) {
          const loadedSheets = Object.values(data.sheets).map((sheet: any) => ({
            id: sheet.id,
            name: sheet.name,
            position: 0 // logic to determine position
          }));
          setWorksheets(loadedSheets);
          if (loadedSheets.length > 0) setActiveWorksheetId(loadedSheets[0].id);
        }
      } catch (error) {
        console.error('Error fetching workbook:', error);
        showToast('Failed to load workbook', 'error');
      }
    };

    fetchWorkbook();
  }, [id]);

  // Join workbook room for collaboration
  useEffect(() => {
    if (id && user) {
      const workbookId = parseInt(id);
      const userName = user.displayName || user.email || 'Anonymous';
      joinWorkbook(workbookId, user.uid, userName);

      return () => {
        leaveWorkbook(workbookId, user.uid);
      };
    }
  }, [id, user, joinWorkbook, leaveWorkbook]);

  // Listen for cell changes from other users
  useEffect(() => {
    if (!id) return;

    onCellChange((data: any) => {
      console.log('Cell changed by another user:', data);
      if (editorRef.current && data.cellData) {
        const { row, col, value, formula } = data.cellData;
        editorRef.current.updateCell(row, col, value, formula);
      }
    });
  }, [id, onCellChange, showToast]);

  const handleCellChange = React.useCallback((cell: any) => {
    console.log('Cell changed:', cell);

    // Broadcast cell change to other users
    if (id && user) {
      sendCellEdit(parseInt(id), {
        row: cell.row || 0,
        col: cell.col || 0,
        value: cell.value || '',
        formula: cell.formula,
        worksheetId: activeWorksheetId,
      });
    }
  }, [id, user, sendCellEdit, activeWorksheetId]);


  const handleSave = React.useCallback(async (data: any) => {
    console.log('Saving workbook:', data);

    if (!id || !user) {
      showToast('Cannot save: missing workbook ID or user', 'error');
      return;
    }

    try {
      // Create a commit for this save
      const commit = await createCommit(
        parseInt(id),
        user.uid,
        'Manual save'
      );

      showToast(`Saved! Commit: ${commit.hash.substring(0, 8)}`, 'success');
    } catch (error) {
      console.error('Error saving workbook:', error);
      showToast('Failed to save workbook', 'error');
    }
  }, [id, user, showToast]);

  const handleCellSelect = React.useCallback((cell: any) => {
    const address = `${String.fromCharCode(65 + cell.col)}${cell.row + 1}`;
    setSelectedCell(address);
    setCellFormula(cell.formula || (cell.value !== null && cell.value !== undefined ? String(cell.value) : ''));

    // Broadcast cursor move to others
    if (id && user) {
      sendCursorMove(parseInt(id), {
        row: cell.row,
        col: cell.col,
        worksheetId: activeWorksheetId
      });
    }
  }, [id, user, sendCursorMove, activeWorksheetId]);

  const handleFileSelect = async (file: File) => {
    console.log('File selected:', file.name);

    if (!user) {
      showToast('You must be logged in to upload files', 'warning');
      return;
    }

    try {
      const response = await uploadWorkbook(file, user.uid);
      console.log('Upload success:', response);
      showToast('Workbook uploaded successfully!', 'success');
      setIsUploadModalOpen(false);
      if (response.workbook && response.workbook.id) {
        navigate(`/editor/${response.workbook.id}`);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      showToast('Failed to upload workbook', 'error');
    }
  };

  const handleFormatChange = (format: any) => {
    console.log('Format changed:', format);

    // Map format changes to Univer commands
    if (format.bold !== undefined) {
      editorRef.current?.executeCommand('sheet.command.set-range-bold', { value: format.bold });
    }
    if (format.italic !== undefined) {
      editorRef.current?.executeCommand('sheet.command.set-range-italic', { value: format.italic });
    }
    if (format.underline !== undefined) {
      editorRef.current?.executeCommand('sheet.command.set-range-underline', { value: format.underline });
    }
    if (format.fontSize) {
      editorRef.current?.executeCommand('sheet.command.set-range-font-size', { value: parseInt(format.fontSize) });
    }
    if (format.fontFamily) {
      editorRef.current?.executeCommand('sheet.command.set-range-font-family', { value: format.fontFamily });
    }
    if (format.alignment) {
      const alignmentMap: Record<string, number> = {
        left: 1,
        center: 2,
        right: 3,
      };
      editorRef.current?.executeCommand('sheet.command.set-range-horizontal-alignment', {
        value: alignmentMap[format.alignment] || 1,
      });
    }
  };

  const handleFormulaChange = (formula: string) => {
    setCellFormula(formula);
  };

  const handleFormulaSubmit = (formula: string) => {
    console.log('Formula submitted:', formula);
    editorRef.current?.setValue(formula);
  };

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    console.log('Zoom changed:', newZoom);
    editorRef.current?.setZoom(newZoom);
  };

  const handleWorksheetCreate = () => {
    const newId = `sheet-${Date.now()}`;
    const newWorksheet = {
      id: newId,
      name: `Sheet${worksheets.length + 1}`,
      position: worksheets.length,
    };
    setWorksheets([...worksheets, newWorksheet]);
    setActiveWorksheetId(newId);
  };

  const handleWorksheetRename = (worksheetId: string, newName: string) => {
    setWorksheets(
      worksheets.map((ws) =>
        ws.id === worksheetId ? { ...ws, name: newName } : ws
      )
    );
  };

  const handleWorksheetDelete = (worksheetId: string) => {
    if (worksheets.length > 1) {
      const newWorksheets = worksheets.filter((ws) => ws.id !== worksheetId);
      setWorksheets(newWorksheets);
      if (activeWorksheetId === worksheetId) {
        setActiveWorksheetId(newWorksheets[0].id);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Editor Toolbar */}
      <EditorToolbar
        onSave={handleSave}
        onUpload={() => setIsUploadModalOpen(true)}
        onFormatChange={handleFormatChange}
      />

      {/* Formula Bar */}
      <FormulaBar
        selectedCell={selectedCell}
        cellFormula={cellFormula}
        onFormulaChange={handleFormulaChange}
        onFormulaSubmit={handleFormulaSubmit}
      />

      {/* Main Container for Side-by-Side Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Main Editor Area */}
        <div className="flex-1 overflow-auto p-6 transition-all duration-300">
          <div className="max-w-full mx-auto">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              {/* Zoom Controls */}
              <div className="flex justify-end p-4 border-b border-gray-200">
                <ZoomControls
                  initialZoom={zoom}
                  onZoomChange={handleZoomChange}
                />
              </div>

              {/* Excel Editor */}
              <div className="p-4">
                <ExcelEditor
                  ref={editorRef}
                  workbookData={workbookData}
                  onCellSelect={handleCellSelect}
                  onCellChange={handleCellChange}
                  onSave={(data: any) => {
                    console.log('Workbook saved:', data);
                    if (id && user) {
                      createCommit(parseInt(id), user.uid, 'Manual save', data)
                        .then(() => showToast('Changes saved and committed', 'success'))
                        .catch(() => showToast('Failed to save commit', 'error'));
                    }
                  }}
                />
              </div>

              {/* Worksheet Tabs */}
              <WorksheetTabs
                worksheets={worksheets}
                activeWorksheetId={activeWorksheetId}
                onWorksheetChange={setActiveWorksheetId}
                onWorksheetCreate={handleWorksheetCreate}
                onWorksheetRename={handleWorksheetRename}
                onWorksheetDelete={handleWorksheetDelete}
              />
            </div>

            {/* Collaborative Cursors Overlay */}
            <div className="relative mt-4">
              <CollaborativeCursors
                cursors={Array.from(cursors.values()).map((cursor: any) => ({
                  userId: cursor.socketId,
                  userName: activeUsers.find((u: any) => u.socketId === cursor.socketId)?.userName || 'Unknown',
                  color: activeUsers.find((u: any) => u.socketId === cursor.socketId)?.color || '#000',
                  cellReference: `${String.fromCharCode(65 + cursor.position.col)}${cursor.position.row + 1}`,
                  position: { x: cursor.position.col * 100, y: cursor.position.row * 25 }
                }))}
              />
            </div>
          </div>
        </div>

        {/* Sidebar Toggle Button (When Closed) */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 bg-white border border-gray-200 p-2 rounded-l-md shadow-md z-20 hover:bg-gray-50 transition-all flex items-center justify-center"
            title="Open Sidebar"
          >
            {React.createElement(FiChevronLeft as any, { size: 20, className: 'text-gray-600' })}
          </button>
        )}

        {/* Right Sidebar - Collaboration & Version History */}
        <div
          className={`bg-white border-l border-gray-200 flex flex-col shadow-xl transition-all duration-300 ease-in-out relative z-10 ${isSidebarOpen ? 'w-80 opacity-100 animate-in' : 'w-0 opacity-0 overflow-hidden border-none'
            }`}
        >
          {isSidebarOpen && (
            <>
              {/* Sidebar Header/Close Button */}
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center space-x-2">
                  {React.createElement(FiSidebar as any, { size: 16, className: 'text-gray-500' })}
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Workspace</span>
                </div>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-1 hover:bg-gray-200 rounded-md transition-colors"
                  title="Close Sidebar"
                >
                  {React.createElement(FiChevronRight as any, { size: 18, className: 'text-gray-500' })}
                </button>
              </div>

              {/* Sidebar Tabs */}
              <div className="flex border-b border-gray-200">
                <button
                  onClick={() => { setShowCollaborators(true); setShowVersionHistory(false); }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${showCollaborators ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                >
                  Users ({activeUsers.length})
                </button>
                <button
                  onClick={() => { setShowVersionHistory(true); setShowCollaborators(false); }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${showVersionHistory ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                >
                  History
                </button>
              </div>

              {/* Sidebar Content */}
              <div className="flex-1 overflow-y-auto">
                {showCollaborators && (
                  <WhosEditingSidebar
                    isOpen={true}
                    users={activeUsers.map((u: any) => ({
                      id: u.userId,
                      name: u.userName,
                      email: 'Collaborator',
                      color: u.color,
                      lastActive: new Date()
                    }))}
                  />
                )}

                {showVersionHistory && id && (
                  <VersionHistoryTimeline
                    workbookId={parseInt(id)}
                    onCommitSelect={(commit: any) => {
                      setSelectedCommitForRollback(commit);
                      setIsRollbackModalOpen(true);
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* File Upload Modal */}
      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onFileSelect={handleFileSelect}
      />
      {/* Rollback Modal */}
      {selectedCommitForRollback && (
        <RollbackModal
          isOpen={isRollbackModalOpen}
          workbookId={parseInt(id || '0')}
          commitId={selectedCommitForRollback.id}
          userId={user?.uid || ''}
          commitMessage={selectedCommitForRollback.message || 'Auto-save'}
          commitDate={selectedCommitForRollback.timestamp}
          changesCount={selectedCommitForRollback.changes_count || 0}
          onConfirm={() => {
            setIsRollbackModalOpen(false);
            // Refresh workbook and history
            window.location.reload();
          }}
          onCancel={() => setIsRollbackModalOpen(false)}
        />
      )}
    </div>
  );
};

export default Editor;