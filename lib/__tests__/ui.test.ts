import { CliProgressBarFactory, StatusDisplay } from '../ui';
import { IProgressBar, IProgressMultiBar } from '../interfaces/progress-interface';

describe('ui', () => {
    describe('CliProgressBarFactory', () => {
        it('should create a multi-progress bar', () => {
            const factory = new CliProgressBarFactory();
            const multibar = factory.createMultiBar({});

            expect(multibar).toBeDefined();
            expect(typeof multibar.create).toBe('function');
            expect(typeof multibar.stop).toBe('function');
        });

        it('should create progress bars with custom options', () => {
            const factory = new CliProgressBarFactory();
            const multibar = factory.createMultiBar({
                format: 'custom format',
                barCompleteChar: '=',
                barIncompleteChar: '-',
            });

            expect(multibar).toBeDefined();
        });

        it('should create progress bars that can be used', () => {
            const factory = new CliProgressBarFactory();
            const multibar = factory.createMultiBar({});
            const progressBar = multibar.create(100, 0, { name: 'test' });

            expect(progressBar).toBeDefined();
            expect(typeof progressBar.setTotal).toBe('function');
            expect(typeof progressBar.update).toBe('function');
            expect(typeof progressBar.stop).toBe('function');

            // Test that methods can be called without errors
            progressBar.setTotal(200);
            progressBar.update(50);
            progressBar.stop();

            multibar.stop();
        });
    });

    describe('StatusDisplay', () => {
        let originalStdoutWrite: typeof process.stdout.write;
        let stdoutWriteMock: jest.Mock;
        let displays: StatusDisplay[] = [];

        beforeEach(() => {
            stdoutWriteMock = jest.fn();
            originalStdoutWrite = process.stdout.write;
            process.stdout.write = stdoutWriteMock as any;
            displays = [];
        });

        afterEach(() => {
            // Stop all displays to clean up intervals
            displays.forEach(display => {
                try {
                    display.stop();
                } catch (e) {
                    // Ignore errors during cleanup
                }
            });
            displays = [];
            process.stdout.write = originalStdoutWrite;
        });

        it('should initialize with pending status for all items', () => {
            const items = [
                { name: 'app1' },
                { name: 'app2' },
            ];

            const display = new StatusDisplay(items);

            // Status should be pending for all items
            items.forEach(item => {
                const status = (display as any).statusLines.get(item.name);
                expect(status.status).toBe('pending');
            });
        });

        it('should update status for an item', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);

            display.setStatus('app1', 'installing');

            const status = (display as any).statusLines.get('app1');
            expect(status.status).toBe('installing');
        });

        it('should update status with elapsed time', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);

            display.setStatus('app1', 'installing', 5000);

            const status = (display as any).statusLines.get('app1');
            expect(status.status).toBe('installing');
            expect(status.elapsed).toBe(5000);
        });

        it('should start display and write initial output', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.start();

            expect(stdoutWriteMock).toHaveBeenCalled();
            const output = stdoutWriteMock.mock.calls.join('');
            expect(output).toContain('app1');
            expect(output).toContain('Pending');

            display.stop();
        });

        it('should display multiple items with prefixes', () => {
            const items = [
                { name: 'app1' },
                { name: 'app2' },
            ];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.start();

            const output = stdoutWriteMock.mock.calls.join('');
            expect(output).toContain('[1/2]');
            expect(output).toContain('[2/2]');

            display.stop();
        });

        it('should update display with status changes', (done) => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.start();
            stdoutWriteMock.mockClear();

            display.setStatus('app1', 'installing', 1000);

            // Wait for update interval
            setTimeout(() => {
                expect(stdoutWriteMock).toHaveBeenCalled();
                const output = stdoutWriteMock.mock.calls.join('');
                expect(output).toContain('Installing');
                display.stop();
                done();
            }, 150);
        });

        it('should display completed status', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.setStatus('app1', 'completed');
            display.start();
            stdoutWriteMock.mockClear();

            // Trigger update
            (display as any).updateDisplay();

            const output = stdoutWriteMock.mock.calls.join('');
            expect(output).toContain('✓');
            expect(output).toContain('Completed');

            display.stop();
        });

        it('should display failed status', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.setStatus('app1', 'failed');
            display.start();
            stdoutWriteMock.mockClear();

            // Trigger update
            (display as any).updateDisplay();

            const output = stdoutWriteMock.mock.calls.join('');
            expect(output).toContain('✗');
            expect(output).toContain('Failed');

            display.stop();
        });

        it('should stop and finalize display', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.start();
            stdoutWriteMock.mockClear();

            display.stop();

            expect(stdoutWriteMock).toHaveBeenCalled();
        });

        it('should finalize display', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.start();
            stdoutWriteMock.mockClear();

            display.finalize();

            expect(stdoutWriteMock).toHaveBeenCalled();
        });

        it('should handle spinner animation', (done) => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.start();
            display.setStatus('app1', 'installing');
            stdoutWriteMock.mockClear();

            // Wait for multiple update cycles
            setTimeout(() => {
                expect(stdoutWriteMock).toHaveBeenCalled();
                display.stop();
                done();
            }, 250);
        });

        it('should format elapsed time in seconds', () => {
            const items = [{ name: 'app1' }];
            const display = new StatusDisplay(items);
            displays.push(display);

            display.setStatus('app1', 'installing', 5000);
            display.start();
            stdoutWriteMock.mockClear();

            (display as any).updateDisplay();

            const output = stdoutWriteMock.mock.calls.join('');
            expect(output).toContain('5s');

            display.stop();
        });
    });
});

