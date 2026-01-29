const API_URL = 'http://localhost:5000/api';

export const uploadWorkbook = async (file: File, ownerId: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('owner_id', ownerId);

    const response = await fetch(`${API_URL}/workbooks/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error('Failed to upload workbook');
    }

    return response.json();
};

export const getWorkbooks = async (ownerId: string) => {
    const response = await fetch(`${API_URL}/workbooks?owner_id=${ownerId}`);
    if (!response.ok) {
        throw new Error('Failed to fetch workbooks');
    }
    return response.json();
};

export const getWorkbookData = async (workbookId: string) => {
    const response = await fetch(`${API_URL}/workbooks/${workbookId}`);
    if (!response.ok) {
        throw new Error('Failed to fetch workbook data');
    }
    return response.json();
};

// ============================================
// VERSION CONTROL API
// ============================================

export interface Commit {
    id: number;
    workbook_id: number;
    user_id: string;
    message: string;
    timestamp: string;
    hash: string;
    changes_count?: number;
}

export interface CellChange {
    id: number;
    commit_id: number;
    cell_id: number;
    address: string;
    row_idx: number;
    col_idx: number;
    worksheet_name: string;
    value: string | null;
    formula: string | null;
    style: any;
}

export interface CommitDetails {
    commit: Commit;
    changes: CellChange[];
}

// Create a new commit (snapshot)
export const createCommit = async (workbook_id: number, user_id: string, message?: string) => {
    const response = await fetch(`${API_URL}/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workbook_id, user_id, message }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create commit');
    }

    return response.json();
};

// Get commit history for a workbook
export const getCommitHistory = async (workbook_id: number, limit: number = 50, offset: number = 0): Promise<{ commits: Commit[] }> => {
    const response = await fetch(`${API_URL}/workbooks/${workbook_id}/commits?limit=${limit}&offset=${offset}`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch commit history');
    }

    return response.json();
};

// Get detailed commit information
export const getCommitDetails = async (commit_id: number): Promise<CommitDetails> => {
    const response = await fetch(`${API_URL}/commits/${commit_id}`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch commit details');
    }

    return response.json();
};

// Rollback workbook to a specific commit
export const rollbackToCommit = async (workbook_id: number, commit_id: number, user_id: string) => {
    const response = await fetch(`${API_URL}/workbooks/${workbook_id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit_id, user_id }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to rollback');
    }

    return response.json();
};
