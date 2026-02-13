import React, { useEffect, useRef } from 'react';
import { LocaleType, Univer } from '@univerjs/core';
import { defaultTheme } from '@univerjs/design';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverUIPlugin } from '@univerjs/ui';
// @ts-ignore
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import '@univerjs/ui/facade';
import '@univerjs/docs-ui/facade';
import '@univerjs/sheets-ui/facade';
import { Commit } from '../services/api';

// Import Univer locales
import DesignEnUS from '@univerjs/design/lib/locale/en-US';
import UIEnUS from '@univerjs/ui/lib/locale/en-US';
import DocsUIEnUS from '@univerjs/docs-ui/lib/locale/en-US';
import SheetsUIEnUS from '@univerjs/sheets-ui/lib/locale/en-US';
import SheetsFormulaEnUS from '@univerjs/sheets-formula/lib/locale/en-US';

// Import Univer styles
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';

export interface ExcelEditorRef {
    save: () => void;
    executeCommand: (id: string, params?: any) => void;
    setZoom: (zoom: number) => void;
    setValue: (value: string) => void;
    getSelection: () => any;
    updateCell: (row: number, col: number, value: any, formula?: string) => void;
}

interface ExcelEditorProps {
    workbookData?: any;
    onCellChange?: (cell: any) => void;
    onCellSelect?: (cell: { row: number; col: number; value: any; formula?: string }) => void;
    onSave?: (data: any) => void;
    readOnly?: boolean;
    ref?: React.Ref<ExcelEditorRef>;
}

const ExcelEditor = React.forwardRef<ExcelEditorRef, ExcelEditorProps>(({
    workbookData,
    onCellChange,
    onCellSelect,
    onSave,
    readOnly = false,
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const univerRef = useRef<Univer | null>(null);
    const fUniverRef = useRef<FUniver | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        console.log('Initializing Univer with locales:', {
            design: !!DesignEnUS,
            ui: !!UIEnUS,
            docs: !!DocsUIEnUS,
            sheets: !!SheetsUIEnUS,
            formula: !!SheetsFormulaEnUS
        });

        // Initialize Univer instance
        const univer = new Univer({
            theme: defaultTheme,
            locale: LocaleType.EN_US,
            locales: {
                [LocaleType.EN_US]: {
                    ...DesignEnUS,
                    ...UIEnUS,
                    ...DocsUIEnUS,
                    ...SheetsUIEnUS,
                    ...SheetsFormulaEnUS,
                },
                'en-US': {
                    ...DesignEnUS,
                    ...UIEnUS,
                    ...DocsUIEnUS,
                    ...SheetsUIEnUS,
                    ...SheetsFormulaEnUS,
                }
            },
        });

        // Register plugins
        univer.registerPlugin(UniverRenderEnginePlugin);
        univer.registerPlugin(UniverFormulaEnginePlugin);
        univer.registerPlugin(UniverUIPlugin, {
            container: containerRef.current,
        });

        univer.registerPlugin(UniverDocsPlugin);
        univer.registerPlugin(UniverDocsUIPlugin);

        univer.registerPlugin(UniverSheetsPlugin);
        univer.registerPlugin(UniverSheetsUIPlugin);
        univer.registerPlugin(UniverSheetsFormulaPlugin);

        // Create a default workbook if no data provided
        const defaultWorkbookData = workbookData || {
            id: 'workbook-01',
            name: 'New Workbook',
            sheetOrder: ['sheet-01'],
            appVersion: '0.1.0',
            sheets: {
                'sheet-01': {
                    id: 'sheet-01',
                    name: 'Sheet1',
                    cellData: {
                        0: {
                            0: {
                                v: 'Welcome to XcelTrack!',
                                s: {
                                    ff: 'Arial',
                                    fs: 14,
                                    bl: 1,
                                },
                            },
                        },
                    },
                    rowCount: 1000,
                    columnCount: 26,
                },
            },
        };

        // Create workbook
        univer.createUniverSheet(defaultWorkbookData);

        // Store univer instance
        univerRef.current = univer;

        // Initialize Facade API
        const fUniver = FUniver.newAPI(univer);
        fUniverRef.current = fUniver;

        // Setup Event Listeners using absolute Event names to avoid type issues
        const selectionSubscription = fUniver.addEvent(fUniver.Event.SelectionChanged, (params: any) => {
            const { selections } = params;
            if (selections && selections.length > 0 && onCellSelect) {
                const range = selections[0];
                const row = range.startRow;
                const col = range.startColumn;

                // Get cell value/formula
                const activeWorkbook = fUniver.getActiveWorkbook();
                if (activeWorkbook) {
                    const activeSheet = activeWorkbook.getActiveSheet();
                    if (activeSheet) {
                        const cellData = activeSheet.getRange(row, col).getValue();
                        onCellSelect({
                            row,
                            col,
                            value: cellData?.v || '',
                            formula: cellData?.f || ''
                        });
                    }
                }
            }
        });

        // Cell Value Change
        const commandSubscription = fUniver.addEvent(fUniver.Event.CommandExecuted, (command: any) => {
            // Check if it's a cell edit command
            if (command.id === 'sheet.command.set-range-values' && onCellChange) {
                onCellChange(command.params);
            }
        });

        return () => {
            selectionSubscription.dispose();
            commandSubscription.dispose();
            univer.dispose();
            univerRef.current = null;
            fUniverRef.current = null;
        };

    }, [workbookData, onCellChange, onCellSelect]);

    // Expose methods via ref
    React.useImperativeHandle(ref, () => ({
        save: () => {
            if (univerRef.current && onSave) {
                const workbook = (univerRef.current as any).getUniverSheetInstance('workbook-01');
                if (workbook) {
                    const data = workbook.save();
                    onSave(data);
                }
            }
        },
        executeCommand: (id: string, params?: any) => {
            if (fUniverRef.current) {
                fUniverRef.current.executeCommand(id, params);
            }
        },
        setZoom: (zoom: number) => {
            if (fUniverRef.current) {
                const activeWorkbook = fUniverRef.current.getActiveWorkbook();
                if (activeWorkbook) {
                    const activeSheet = activeWorkbook.getActiveSheet();
                    if (activeSheet) {
                        // univerAPI.executeCommand('sheet.command.set-zoom', { zoom, unitId, subUnitId })
                        fUniverRef.current.executeCommand('sheet.command.set-zoom', {
                            zoomRatio: zoom / 100,
                            unitId: activeWorkbook.getId(),
                            subUnitId: activeSheet.getSheetId()
                        });
                    }
                }
            }
        },
        setValue: (value: string) => {
            if (fUniverRef.current) {
                const activeWorkbook = fUniverRef.current.getActiveWorkbook();
                if (activeWorkbook) {
                    const activeSheet = activeWorkbook.getActiveSheet();
                    if (activeSheet) {
                        const range = activeSheet.getSelection()?.getActiveRange();
                        if (range) {
                            range.setValue(value);
                        }
                    }
                }
            }
        },
        getSelection: () => {
            if (fUniverRef.current) {
                const activeWorkbook = fUniverRef.current.getActiveWorkbook();
                if (activeWorkbook) {
                    const activeSheet = activeWorkbook.getActiveSheet();
                    if (activeSheet) {
                        const selection = activeSheet.getSelection();
                        const range = selection?.getActiveRange();
                        if (range) {
                            return {
                                row: range.getRow(),
                                col: range.getColumn(),
                                rowCount: range.getHeight(),
                                colCount: range.getWidth()
                            };
                        }
                    }
                }
            }
            return null;
        },
        updateCell: (row: number, col: number, value: any, formula?: string) => {
            if (fUniverRef.current) {
                const activeWorkbook = fUniverRef.current.getActiveWorkbook();
                if (activeWorkbook) {
                    const activeSheet = activeWorkbook.getActiveSheet();
                    if (activeSheet) {
                        const range = activeSheet.getRange(row, col);
                        if (formula) {
                            range.setValue(formula);
                        } else {
                            range.setValue(value);
                        }
                    }
                }
            }
        },
    }));

    // Handle save action
    const handleSave = () => {
        if (univerRef.current && onSave) {
            // Get current workbook data using sheet instance
            const workbook = (univerRef.current as any).getUniverSheetInstance('workbook-01');
            if (workbook) {
                const data = workbook.save();
                onSave(data);
            }
        }
    };

    return (
        <div className="excel-editor-container h-full flex flex-col">
            {/* Univer container */}
            <div
                ref={containerRef}
                className="univer-container flex-1"
                style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '400px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    overflow: 'hidden',
                }}
            />
        </div>
    );
});

export default ExcelEditor;
