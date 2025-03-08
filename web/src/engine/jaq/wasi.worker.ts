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

export class Wasip1 {
  #memory: WebAssembly.Memory | undefined;
  #args: Uint8Array[];
  #stdin: Read;
  #stdout: Write;
  #stderr: Write;

  constructor(args: Uint8Array[], stdin: Read, stdout: Write, stderr: Write) {
    this.#args = args;
    this.#stdin = stdin;
    this.#stdout = stdout;
    this.#stderr = stderr;
  }

  get memory(): WebAssembly.Memory {
    if (typeof this.#memory === "undefined") {
      throw new Error("memory: not set.");
    }
    return this.#memory;
  }

  args_get(argv: number, arg_buf: number) {
    const view = new DataView(this.memory.buffer);

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

  args_sizes_get(argc: number, arg_buf_size: number): number {
    const view = new DataView(this.memory.buffer);
    view.setUint32(argc, this.#args.length, true);
    view.setUint32(
      arg_buf_size,
      this.#args.reduce((l, r) => l + r.length + 1, 0),
      true,
    );
    return success;
  }

  fd_read(fd: Fd, iovec: number, iovec_len: number, nread: number): Errno {
    let read: Read;
    switch (fd) {
      case fdStdin:
        read = this.#stdin;
        break;
      default:
        return ebadf;
    }

    const view = new DataView(this.memory.buffer);
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

  fd_write(fd: Fd, iovec: number, iovec_len: number, nwritten: number): Errno {
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

    const view = new DataView(this.memory.buffer);
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

  environ_get(): Errno {
    return enosys; // never
  }

  environ_sizes_get(environc: number, env_buf_size: number): Errno {
    const view = new DataView(this.memory.buffer);
    view.setUint32(environc, 0, true);
    view.setUint32(env_buf_size, 0, true);
    return success;
  }

  fd_fdstat_get(fd: Fd, _fdstat: number): Errno {
    switch (fd) {
      case fdStdin:
      case fdStdout:
      case fdStderr:
        return enosys;
      default:
        return ebadf;
    }
  }

  proc_exit(rval: number): never {
    throw new ExitError(rval);
  }

  get imports(): WebAssembly.Imports {
    function notImplemented(s: string): () => never {
      return () => {
        throw new Error(`Not implemented: ${s}`);
      };
    }

    return {
      wasi_snapshot_preview1: {
        random_get: notImplemented("random_get"),
        args_get: this.args_get.bind(this),
        args_sizes_get: this.args_sizes_get.bind(this),
        clock_time_get: notImplemented("clock_time_get"),
        fd_filestat_get: notImplemented("fd_filestat_get"),
        fd_read: this.fd_read.bind(this),
        fd_write: this.fd_write.bind(this),
        path_filestat_get: notImplemented("path_filestat_get"),
        path_link: notImplemented("path_link"),
        path_open: notImplemented("path_open"),
        path_unlink_file: notImplemented("path_unlink_file"),
        environ_get: this.environ_get.bind(this),
        environ_sizes_get: this.environ_sizes_get.bind(this),
        fd_close: notImplemented("fd_close"),
        fd_fdstat_get: this.fd_fdstat_get.bind(this),
        fd_prestat_get: notImplemented("fd_prestat_get"),
        fd_prestat_dir_name: notImplemented("fd_prestat_dir_name"),
        path_rename: notImplemented("path_rename"),
        proc_exit: this.proc_exit.bind(this),
      },
    };
  }

  async start(module: WebAssembly.Module): Promise<void> {
    const instance = await WebAssembly.instantiate(module, this.imports);

    const { memory, _start } = instance.exports;

    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error("!(memory instanceof WebAssembly.Memory)");
    }
    this.#memory = memory;

    if (typeof _start !== "function") {
      throw new Error("typeof _start !== 'function'");
    }
    _start();
  }
}
