// REF https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md

type Errno = number & { readonly __ErrnoBranded: never };

// success No error occurred. System call completed successfully.
const success = 0 as Errno;
// badf Bad file descriptor.
const ebadf = 8 as Errno;
// nosys Function not supported.
const enosys = 52 as Errno;

type Fd = number & { readonly __FdBranded: never };

const fdStdin = 0 as Fd;
const fdStdout = 1 as Fd;
const fdStderr = 2 as Fd;

export type Read = (buf: Uint8Array) => number;
export type Write = (buf: Uint8Array) => number;

export class ExitError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`Exit Code: ${code}`);
    this.code = code;
  }
}

class LazyMemory implements WebAssembly.Memory {
  #memory: WebAssembly.Memory | undefined;

  set(memory: WebAssembly.Memory): void {
    this.#memory = memory;
  }

  get buffer(): ArrayBuffer {
    if (typeof this.#memory === "undefined") {
      throw new Error("Not yet set.");
    }

    return this.#memory.buffer;
  }

  grow(delta: number): number {
    if (typeof this.#memory === "undefined") {
      throw new Error("Not yet set.");
    }

    return this.#memory.grow(delta);
  }
}

type Wasip1Imports = {
  // biome-ignore lint/complexity/noBannedTypes: WebAssembly ambiguous function types
  wasi_snapshot_preview1: Record<string, Function> & {
    args_get(argv: number, arg_buf: number): Errno;
    args_sizes_get(argc: number, arg_buf_size: number): Errno;
    fd_read(fd: Fd, iovec: number, iovec_len: number, nread: number): Errno;
    fd_write(fd: Fd, iovec: number, iovec_len: number, nwritten: number): Errno;
    environ_get(environ: number, environ_buf: number): Errno;
    environ_sizes_get(environc: number, env_buf_size: number): Errno;
    fd_fdstat_get(fd: Fd, fdstat: number): Errno;
    proc_exit(rval: number): Errno;
  };
};

export type Instantiate = (
  imports: WebAssembly.Imports & Wasip1Imports,
) => Promise<WebAssembly.Instance>;

export class Wasip1 {
  readonly #args: Uint8Array[];
  readonly #stdin: Read;
  readonly #stdout: Write;
  readonly #stderr: Write;

  constructor(args: Uint8Array[], stdin: Read, stdout: Write, stderr: Write) {
    this.#args = args;
    this.#stdin = stdin;
    this.#stdout = stdout;
    this.#stderr = stderr;
  }

  args_get(memory: WebAssembly.Memory, argv: number, arg_buf: number): Errno {
    const view = new DataView(memory.buffer);

    let argv_p = argv;
    let arg_buf_p = arg_buf;
    for (const arg of this.#args) {
      view.setUint32(argv_p, arg_buf_p, true);
      argv_p += Uint32Array.BYTES_PER_ELEMENT;

      new Uint8Array(view.buffer, arg_buf_p, arg.length).set(arg);
      // Each argument is expected to be \0 terminated.
      view.setUint8(arg_buf_p + arg.length, 0);
      arg_buf_p += arg.length + 1;
    }
    return success;
  }

  args_sizes_get(
    memory: WebAssembly.Memory,
    argc: number,
    arg_buf_size: number,
  ): Errno {
    const view = new DataView(memory.buffer);
    view.setUint32(argc, this.#args.length, true);
    view.setUint32(
      arg_buf_size,
      this.#args.reduce((l, r) => l + r.length + 1, 0),
      true,
    );
    return success;
  }

  fd_read(
    memory: WebAssembly.Memory,
    fd: Fd,
    iovec: number,
    iovec_len: number,
    nread: number,
  ): Errno {
    let read: Read;
    switch (fd) {
      case fdStdin:
        read = this.#stdin;
        break;
      default:
        return ebadf;
    }

    const view = new DataView(memory.buffer);
    let total = 0;
    for (let i = 0; i < iovec_len; i++) {
      const off = view.getUint32(iovec + i * 8 + 0, true);
      const len = view.getUint32(iovec + i * 8 + 4, true);
      const buf = new Uint8Array(view.buffer, off, len);

      total += read(buf);
    }
    view.setUint32(nread, total, true);
    return success;
  }

  fd_write(
    memory: WebAssembly.Memory,
    fd: Fd,
    iovec: number,
    iovec_len: number,
    nwritten: number,
  ): Errno {
    let write: Write;
    switch (fd) {
      case 1:
        write = this.#stdout;
        break;
      case 2:
        write = this.#stderr;
        break;
      default:
        return ebadf;
    }

    const view = new DataView(memory.buffer);
    let total = 0;
    for (let i = 0; i < iovec_len; i++) {
      const off = view.getUint32(iovec + i * 8 + 0, true);
      const len = view.getUint32(iovec + i * 8 + 4, true);
      const buf = new Uint8Array(view.buffer, off, len);

      total += write(buf);
    }
    view.setUint32(nwritten, total, true);
    return success;
  }

  environ_get(
    _: WebAssembly.Memory,
    _environ: number,
    _environ_buf: number,
  ): Errno {
    return enosys; // never
  }

  environ_sizes_get(
    memory: WebAssembly.Memory,
    environc: number,
    env_buf_size: number,
  ): Errno {
    const view = new DataView(memory.buffer);
    view.setUint32(environc, 0, true);
    view.setUint32(env_buf_size, 0, true);
    return success;
  }

  fd_fdstat_get(_: WebAssembly.Memory, fd: Fd, _fdstat: number): Errno {
    switch (fd) {
      case fdStdin:
      case fdStdout:
      case fdStderr:
        return enosys;
      default:
        return ebadf;
    }
  }

  proc_exit(_: WebAssembly.Memory, rval: number): never {
    throw new ExitError(rval);
  }

  imports(memory: WebAssembly.Memory): Wasip1Imports {
    type Bound<F> = F extends (m: WebAssembly.Memory, ...rest: infer A) => Errno
      ? (...rest: A) => Errno
      : never;
    // biome-ignore lint/suspicious/noExplicitAny: needs any
    const bind = <F extends (m: WebAssembly.Memory, ...rest: any[]) => Errno>(
      fn: F,
    ): Bound<F> => {
      return fn.bind(this, memory) as Bound<F>;
    };

    function notImplemented(s: string): () => never {
      return () => {
        throw new Error(`Not implemented: ${s}`);
      };
    }

    return {
      wasi_snapshot_preview1: {
        random_get: notImplemented("random_get"),
        args_get: bind(this.args_get),
        args_sizes_get: bind(this.args_sizes_get),
        clock_time_get: notImplemented("clock_time_get"),
        fd_filestat_get: notImplemented("fd_filestat_get"),
        fd_read: bind(this.fd_read),
        fd_write: bind(this.fd_write),
        path_filestat_get: notImplemented("path_filestat_get"),
        path_link: notImplemented("path_link"),
        path_open: notImplemented("path_open"),
        path_unlink_file: notImplemented("path_unlink_file"),
        environ_get: bind(this.environ_get),
        environ_sizes_get: bind(this.environ_sizes_get),
        fd_close: notImplemented("fd_close"),
        fd_fdstat_get: bind(this.fd_fdstat_get),
        fd_prestat_get: notImplemented("fd_prestat_get"),
        fd_prestat_dir_name: notImplemented("fd_prestat_dir_name"),
        path_rename: notImplemented("path_rename"),
        proc_exit: bind(this.proc_exit),
      },
    };
  }

  async start(instantiate: Instantiate): Promise<void> {
    const lazy = new LazyMemory();
    const {
      exports: { memory, _start },
    } = await instantiate(this.imports(lazy));

    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error("!(memory instanceof WebAssembly.Memory)");
    }
    lazy.set(memory);

    if (typeof _start !== "function") {
      throw new Error("typeof _start !== 'function'");
    }
    _start();
  }
}

if (import.meta.vitest) {
  /* v8 ignore start */
  const { describe, it } = import.meta.vitest;

  describe("Wasip1", () => {
    const ban: Read | Write = () => {
      throw new Error("ban");
    };

    it("env", async ({ expect }) => {
      const wasi = new Wasip1([], ban, ban, ban);

      const memory = new WebAssembly.Memory({ initial: 128 });
      await wasi.start((imports) =>
        Promise.resolve({
          exports: {
            memory,
            _start() {
              const wasi = imports.wasi_snapshot_preview1;
              const view = new DataView(memory.buffer); // never grow

              let ret: Errno;

              const environc = 4; // size (u32)
              const env_buf_size = 8; // size (u32)
              ret = wasi.environ_sizes_get(environc, env_buf_size);
              expect(ret).toBe(success);
              expect(view.getUint32(environc, true)).toBe(0);
              expect(view.getUint32(env_buf_size, true)).toBe(0);

              const environ = 12; // Pointer (u32)
              const environ_buf = 16; // Pointer (u32)
              ret = wasi.environ_get(environ, environ_buf);
              expect(ret).toBe(enosys);
            },
          },
        }),
      );
    });

    it("args", async ({ expect }) => {
      const args = [
        "program", // 7 + 1
        "--opt", // 5 + 1
        "val", // 3 + 1
        "hello,", // 6 + 1
        "world!", // 6 + 1
        "🐱", // 4 + 1
      ];
      const wasi = new Wasip1(
        args.map((v) => new TextEncoder().encode(v)),
        ban,
        ban,
        ban,
      );

      const memory = new WebAssembly.Memory({ initial: 128 });
      await wasi.start((imports) =>
        Promise.resolve({
          exports: {
            memory,
            _start() {
              const wasi = imports.wasi_snapshot_preview1;
              const view = new DataView(memory.buffer); // never grow
              const buf = new Uint8Array(memory.buffer);

              let ret: Errno;

              const argc = 4; // size (u32)
              const arg_buf_size = 8; // size (u32)
              ret = wasi.args_sizes_get(argc, arg_buf_size);
              expect(ret).toBe(success);
              const n = view.getUint32(argc, true);
              expect(n).toBe(6);
              expect(view.getUint32(arg_buf_size, true)).toBe(37);

              const argv = 12; // Pointer (u32) * n
              const arg_buf = 16 + 4 * n; // Pointer (u32)
              ret = wasi.args_get(argv, arg_buf);
              expect(ret).toBe(success);

              for (let i = 0; i < n; i++) {
                const off = view.getUint32(argv + i * 4, true);
                const end = buf.indexOf(0, off);
                expect(end).toBeGreaterThanOrEqual(0);
                const arg = new TextDecoder().decode(buf.subarray(off, end));
                expect(arg).toBe(args[i]);
              }
            },
          },
        }),
      );
    });

    it("fd_read", async ({ expect }) => {
      const read: Read = (buf) => {
        expect(buf.length).toBeLessThanOrEqual(0xff);
        for (let i = 0; i < buf.length; i++) {
          buf[i] = buf.length;
        }
        return buf.length;
      };
      const wasi = new Wasip1([], read, ban, ban);

      const memory = new WebAssembly.Memory({ initial: 128 });
      await wasi.start((imports) =>
        Promise.resolve({
          exports: {
            memory,
            _start() {
              const wasi = imports.wasi_snapshot_preview1;
              const view = new DataView(memory.buffer); // never grow
              const buf = new Uint8Array(memory.buffer);

              let ret: Errno;

              const buf0 = buf.subarray(4, 36);
              const buf1 = buf.subarray(36, 36); // empty
              const buf2 = buf.subarray(36, 37);

              const iovec0 = 64;
              view.setUint32(iovec0 + 0 * 8 + 0, buf0.byteOffset, true);
              view.setUint32(iovec0 + 0 * 8 + 4, buf0.byteLength, true);
              view.setUint32(iovec0 + 1 * 8 + 0, buf1.byteOffset, true);
              view.setUint32(iovec0 + 1 * 8 + 4, buf1.byteLength, true);
              view.setUint32(iovec0 + 2 * 8 + 0, buf2.byteOffset, true);
              view.setUint32(iovec0 + 2 * 8 + 4, buf2.byteLength, true);
              const nread = iovec0 + 3 * 8;

              ret = wasi.fd_read(fdStdin, iovec0, 3, nread);
              expect(ret).toBe(success);
              for (const buf of [buf0, buf1, buf2]) {
                for (const b of buf) {
                  expect(b).toBe(buf.length);
                }
              }
              expect(view.getUint32(nread, true)).toBe(33);

              ret = wasi.fd_read(fdStdout, iovec0, 3, nread);
              expect(ret).toBe(ebadf);
            },
          },
        }),
      );
    });

    it("fd_write", async ({ expect }) => {
      const write: Write = (buf) => {
        expect(buf.length).toBeLessThanOrEqual(0xff);
        for (const b of buf) {
          expect(b).toBe(buf.length);
        }
        return buf.length;
      };
      const wasi = new Wasip1([], ban, write, write);

      const memory = new WebAssembly.Memory({ initial: 128 });
      await wasi.start((imports) =>
        Promise.resolve({
          exports: {
            memory,
            _start() {
              const wasi = imports.wasi_snapshot_preview1;
              const view = new DataView(memory.buffer); // never grow
              const buf = new Uint8Array(memory.buffer);

              let ret: Errno;

              const buf0 = buf.subarray(4, 36);
              const buf1 = buf.subarray(36, 36); // empty
              const buf2 = buf.subarray(36, 37);
              for (const buf of [buf0, buf1, buf2]) {
                for (let i = 0; i < buf.length; i++) {
                  buf[i] = buf.length;
                }
              }

              const iovec0 = 64;
              view.setUint32(iovec0 + 0 * 8 + 0, buf0.byteOffset, true);
              view.setUint32(iovec0 + 0 * 8 + 4, buf0.byteLength, true);
              view.setUint32(iovec0 + 1 * 8 + 0, buf1.byteOffset, true);
              view.setUint32(iovec0 + 1 * 8 + 4, buf1.byteLength, true);
              view.setUint32(iovec0 + 2 * 8 + 0, buf2.byteOffset, true);
              view.setUint32(iovec0 + 2 * 8 + 4, buf2.byteLength, true);
              const nwritten = iovec0 + 3 * 8;

              ret = wasi.fd_write(fdStdout, iovec0, 3, nwritten);
              expect(ret).toBe(success);
              expect(view.getUint32(nwritten, true)).toBe(33);

              ret = wasi.fd_write(fdStderr, iovec0, 3, nwritten);
              expect(ret).toBe(success);
              expect(view.getUint32(nwritten, true)).toBe(33);

              ret = wasi.fd_write(fdStdin, iovec0, 3, nwritten);
              expect(ret).toBe(ebadf);
            },
          },
        }),
      );
    });

    it("fd_fdstat_get", async ({ expect }) => {
      const wasi = new Wasip1([], ban, ban, ban);

      const memory = new WebAssembly.Memory({ initial: 128 });
      await wasi.start((imports) =>
        Promise.resolve({
          exports: {
            memory,
            _start() {
              const wasi = imports.wasi_snapshot_preview1;

              let ret: Errno;

              ret = wasi.fd_fdstat_get(fdStdin, 0);
              expect(ret).toBe(enosys);

              ret = wasi.fd_fdstat_get(fdStdout, 0);
              expect(ret).toBe(enosys);

              ret = wasi.fd_fdstat_get(fdStderr, 0);
              expect(ret).toBe(enosys);

              ret = wasi.fd_fdstat_get(3 as Fd, 0);
              expect(ret).toBe(ebadf);
            },
          },
        }),
      );
    });

    it("proc_exit", async ({ expect }) => {
      const wasi = new Wasip1([], ban, ban, ban);

      const memory = new WebAssembly.Memory({ initial: 128 });
      await wasi.start((imports) =>
        Promise.resolve({
          exports: {
            memory,
            _start() {
              const wasi = imports.wasi_snapshot_preview1;

              expect(() => wasi.proc_exit(255)).toThrow(new ExitError(255));
            },
          },
        }),
      );
    });
  });
}
