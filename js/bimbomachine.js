//  $Id$

"use strict";

// компилятор байткода
function compile(code) {
    var inst_pairs = code.split(' ');
    var instruction_set = [];
    for (var i in inst_pairs) {
        var pair = inst_pairs[i].split(':');
        instruction_set.push({ instr: pair[0],
            ticks: (pair[1] ? parseInt(pair[1]) : 1) });
    }
    return instruction_set;
};

// очередь как основа всех ресурсов и CPU в том числе
function Queue() {
    this.items = [];

    this.queue_size = function() {
        return this.items.length;
    };

    this.enqueue = function (item) {
        this.items.push(item);
    };

    this.dequeue = function () {
        return this.items.shift();
    };
};

function Resource(name) {
    this.name = name;
    this.items = [];                    // XXX: js inheritance workaround
    this.instruction = undefined;       // текущая команда
    this.instruction_ticks = 0;         // счетчик тиков для текущей комманды
    this.interrupt_interval = 5;        // период генерации прерывания
    this.interrupt_ticks = 0;           // время до генерации прерывания

    this.interrupt = function() {
        // обработчик прерываний для данного ресурса
        // см. также execute()
    };

    this.run_instruction = function() {
        // здесь как бы выполняется наша комманда
        // ...тут как бы делается что-то полезное
        console.log(this.name + ": run_instruction: "
            + this.instruction.instr + ":" + this.instruction.ticks);
    };

    this.execute = function() {
        // ресурс может отвлечься на обработку прерывания, и это может
        // произойти на любой команде. То есть таким образом мы эмулируем
        // работу контроллера прерываний. Поскольку данная модель не
        // должна точно воспроизводить работу контроллера, будет достаточно,
        // если обработчик будет сам решать, когда обрабатывать прерывание,
        // а когда нет. Однако, в случае если устройство выполняет длинную
        // команду, и прерывание приходится на середину этой команды,
        // такое прерывание нужно принудительно маскировать
        this.interrupt_ticks--;
        if (this.interrupt_ticks <= 0 && this.instruction_ticks <= 0) {
            this.interrupt_ticks = this.interrupt_interval;
            this.interrupt();
        };

        if (this.instruction === undefined) {
            if (0 === this.queue_size())
                return;

            this.instruction = this.dequeue();
            this.instruction_ticks = this.instruction.ticks;
        }

        this.run_instruction();
        this.instruction_ticks--;

        // команда выполнена
        if (this.instruction_ticks <= 0)
            this.instruction = undefined;
    };

    this.isfree = function() {
        return (this.instruction === undefined && this.queue_size() === 0);
    };
};

Resource.inherits(Queue);

function CPU() {
    this.name = "CPU";
    this.scheduler_dispatch_interval = 5;
                            // через сколько тиков CPU запускает планировщик
    this.scheduler = new Scheduler();
    this.ticks = 0;
    this.memory = [];       // организация памяти ЦП - список контекстов
    this.context = 0;       // текущий исполняемый процесс

    this.init = function(machine) {
        this.mach = machine;
        this.context = -1;
    };

    this.halt = function(reason) {
        clearTimeout(this.mach.timer);
        throw new Error(this.name + ": " + reason + "\n"
            + this.name + ": halt.");
    };

    this.interrupt = function() {
        // этим кодом мы эмулируем прерывание, переключающее контекст: то бишь
        // каждые scheduler_dispatch_interval тактов будет выполнятся
        // переключение на планировщик
        console.log(this.name + ": interrupt tick " + this.ticks);

        this.scheduler.dispatch();

        this.ticks++;
    };

    this.run_instruction = function() {
        var mnemocode = this.instruction.instr + ":" + this.instruction.ticks;

        // код инструкции для данной реализации может быть:
        //   C  - команда для процессора
        //   Rn - блокирующая команда для ресурса (выполняется процессором)
        //   Nn - неблокирующая команда для ресурса
        // где n - это обязательный номер ресурса
        var icode = this.instruction.instr.substr(0, 1);
        var rnum = parseInt(this.instruction.instr.substr(1));

        console.log(this.name + ": mnemocode = " + mnemocode
            + ", icode = " + icode + ", rnum = " + rnum);

        if (isNaN(rnum) && icode !== "C") {
            this.halt(mnemocode + ": malformed resource number");
        };

        if (rnum >= this.mach.r.length) {
            this.halt(mnemocode + ": unaddressable resource reference");
        };

        // TODO: допустимое значение вынести в глобальные определения - как?
        if (this.instruction.ticks >= 16) {
            this.halt(mnemocode + ": instruction is too long");
        };

        // N.B.: не забыть проверить queue_weight()
        switch (icode) {
            case "C":
                console.log(this.name + ": executing " + mnemocode
                    + " for context " + this.context);
                break;
            case "R":
                if (this.mach.r[rnum].isfree()) {
                    console.log(this.name + ": exec " + icode + " on "
                        + this.mach.r[rnum].name);
                    this.mach.r[rnum].enqueue( { instr: icode, ticks: 1 } );
                } else {
                    // ждать, пока не освободится нужный ресурс, и при этом
                    // удерживать команду на процессоре
                    console.log(this.name + ": wait for "
                        + this.mach.r[rnum].name);
                    this.instruction_ticks++;
                };
                break;
            case "N":
                console.log(this.name + ": move " + mnemocode
                    + " to " + this.mach.r[rnum].name);
                this.mach.r[rnum].enqueue( { instr: icode,
                    ticks: this.instruction.ticks } );
                // освободить процессор для следующей команды
                this.instruction_ticks = 0;
                break;
            default:
                this.halt(mnemocode + ": malformed instruction code");
        };
    };

    // queue_weight() возвращает вес всей очереди в тактах
    this.queue_weight = function() {
        var weight = 0;

        for (var i in this.items) {
            var icode = this.items[i].instr.substr(0, 1);

            switch (icode) {
            case "C":
            case "R":
                // XXX ожидается только положительное целое число
                //     нужно создать isvalidinstr()?
                weight += this.items[i].ticks;
                break;
            case "N":
                weight += 1;
                break;
            default:
                this.halt("queue_weight: "
                    + this.items[i].instr + ":" + this.items[i].ticks
                    + ": malformed instruction code");
            };
        };

        return weight;
    };

    this.new_context = function(process) {
        this.memory.push(process);
    };
};

CPU.inherits(Resource);

// процесс он же является контекстом нашего CPU
function Process(name, code, pid) {
    this.name = name;
    this.code = code;
    this.pid  = pid;
};

function Scheduler() {
    this.process_count = 0;

    // флаг avoid_idle_ticks управляет возможностью запускать и уничтожать
    // процессы таким образом, чтобы минимизировать время простоя процессора;
    // требуется аппаратная поддержка cpu.queue_weight()
    this.avoid_idle_ticks = true;

    this.init = function(cpu) {
        this.cpu = cpu;
    };

    this.dispatch = function() {
        console.log("scheduler: dispatch");

        var nprocesses = this.cpu.memory.length;

        // нет смысла переключаться, если нет [других] процессов
        if (0 === nprocesses)
            return;

        if (this.cpu.context >= nprocesses - 1) {
            this.cpu.context = 0;
        } else {
            this.cpu.context++;
        };

        this.cpu.items = this.cpu.memory[this.cpu.context].code;

        if (this.avoid_idle_ticks
                && this.cpu.queue_weight() < this.cpu.interrupt_ticks) {
            this.cpu.interrupt_ticks = this.cpu.queue_weight();
            console.log("scheduler: avoid_idle_ticks: short process - "
                + "interrupt within " + this.cpu.interrupt_ticks + " tick(s)");
        };

        console.log("scheduler: " + this.cpu.name + ": new context - "
                + this.cpu.context
                + " (name '" + this.cpu.memory[this.cpu.context].name
                + "', pid " + this.cpu.memory[this.cpu.context].pid + ")");

        if (0 === this.cpu.queue_size()) {
            this.terminate_process(this.cpu.memory[this.cpu.context].pid);
        }
    };

    this.new_process = function(name, code) {
        if (this.avoid_idle_ticks && 0 === this.cpu.memory.length) {
            this.cpu.interrupt_ticks = 0;
            console.log("scheduler: avoid_idle_ticks: "
                + "very first process scheduled");
        };

        var pid = ++this.process_count;
        this.cpu.new_context(new Process(name, code, pid));

        return pid;
    };

    this.terminate_process = function(pid) {
        console.log("scheduler: terminating pid " + pid);

        for (var process in this.cpu.memory) {
            if (this.cpu.memory[process].pid === pid) {
                if (parseInt(process) === this.cpu.context) {
                    // для завершенного процесса нет необходимости
                    // ждать следующего прерывания - вместо этого
                    // контроллер должен быть перепрограммирован так,
                    // чтобы scheduler.dispatch был вызван уже на
                    // следующем такте
                    // TODO: прервать текущий процесс на процессоре
                    this.cpu.interrupt_ticks = 0;
                    console.log("scheduler: reset cpu.interrupt_ticks");
                };

                this.cpu.memory.splice(process, 1);
                return true;
            };
        };
    };
};

function Machine(cycles) {
    this.ticks = cycles;
    this.clock = 500;           // 1/2 секунды
    this.timer = undefined;     // таймер для setTimeout()

    this.cpu = new CPU();

    this.r = [];  // ресурсы машины
    this.r.push(new Resource('Rs0'));
    this.r.push(new Resource('Rs1'));
    this.r.push(new Resource('Rs2'));

    this.load_program = function(name, source) {
        var code = compile(source);
        this.cpu.scheduler.new_process(name, code);
    };

    this.dispatch = function() {
        console.log("-------- tick " + this.ticks + " --------");

        if (this.ticks > 0)
            this.timer = setTimeout(function(machine) { machine.dispatch() },
                this.clock, this);

        this.cpu.execute();

        for ( var resource in this.r ) {
            this.r[resource].execute();
        }

        this.ticks--;
    };

    // поскольку машина уже работает сразу после dispatch(), необходимо
    // предварительно загрузить в процессор стартовый код - планировщик
    this.bootstrap = function() {
        console.log("machine: boot");

        // для связки CPU - Scheduler необходимо решить вопрос
        // "курицы и яйца": ЦП управляется планировщиком, но
        // планировщик работает на ЦП. Поэтому необходимо создать
        // объекты, позволяющие адресоваться к одной сущности в
        // контексте другой, будь то CPU или Scheduler
        this.cpu.scheduler.init(this.cpu);
        this.cpu.init(this);

        this.dispatch();
    };

};

// var machine = new Machine(40);
// machine.bootstrap();
// machine.load_program("cat", "R1:3 N1:4 C C");
// machine.load_program("top", "R1:4 C R2:2 R1:3 C");
