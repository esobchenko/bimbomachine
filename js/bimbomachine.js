"use strict";

// компилятор байткода
function compile(code) {
    var inst_pairs = code.split(' ');
    var instruction_set = [];
    for (var i in inst_pairs) {
        var pair = inst_pairs[i].split(':');
        instruction_set.push({ instr: pair[0], ticks: (pair[1] ? parseInt(pair[1]) : 1) });
    }
    return instruction_set;
};

// очередь как основа всех ресурсов и CPU в том числе
function Queue() {
    this.items = [];

    this.size = function() {
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
    this.instruction = undefined; // текущая команда
    this.instruction_ticks = 0; // счетчик тиков для текущей комманды (сколько тиков выполняется текущая команда)

    this.interrupt = function() {
        // обработчик прерываний для данного ресурса
        // см. также execute()
    };

    this.run_instruction = function(instruction) {
        // здесь как бы выполняется наша комманда
        // ...тут как бы делается что-то полезное
        console.log(this.name + ": " + instruction + ": non implemented");
    };

    this.execute = function() {
        // ресурс может отвлечься на обработку прерывания, и это может
        // произойти на любом такте. То есть таким образом мы эмулируем
        // работу контроллера прерываний. Поскольку данная модель не
        // должна точно воспроизводить работу контроллера, будет достаточно,
        // если обработчик будет сам решать, когда обрабатывать прерывание,
        // а когда нет. Однако, в случае если устройство выполняет длинную
        // команду, и прерывание приходится на середину этой команды,
        // такое прерывание нужно принудительно маскировать
        if (this.instruction === undefined
                || this.instruction_ticks >= this.instruction.ticks)
            this.interrupt();

        if (this.instruction === undefined) {
            if (0 === this.size())
                return;

            this.instruction = this.dequeue();
            this.instruction_ticks = 0;
        }

        this.run_instruction(this.instruction);
        this.instruction_ticks++;

        // команда выполнена
        if (this.instruction_ticks >= this.instruction.ticks)
            this.instruction = undefined;
    };
};

Resource.inherits(Queue);

function CPU() {
    this.name = "CPU";
    this.scheduler_dispatch_interval = 5; // через сколько тиков CPU запускает планировщик
    this.scheduler = new Scheduler();
    this.processes = [];
    this.ticks = 0;
    this.context = 0; // текущий исполняемый процесс

    this.interrupt = function() {
        // этим кодом мы эмулируем прерывание, переключающее контекст: то бишь
        // каждые scheduler_dispatch_interval тактов будет выполнятся переключение
        // на планировщик
        console.log(this.name + ": tick " + this.ticks);

        if ((this.ticks % this.scheduler_dispatch_interval) === 0)
            this.scheduler.dispatch(this);

        this.ticks++;
    };

    this.run_instruction = function(instruction) {
        console.log(this.name + ": executing "
            + instruction.instr + ":" + instruction.ticks
            + " for process #" + this.context);
    };

    this.new_context = function(process) {
        this.processes.push(process);
    };
};

CPU.inherits(Resource);

// процесс он же является контекстом нашего CPU
function Process(name, code) {
    this.name = name;
    this.code = code;
};

function Scheduler() {
    this.dispatch = function(cpu) {
        console.log("scheduler: dispatch");

        var processes_count = cpu.processes.length;

        // нельзя переключать контекст, если команда все еще на процессоре,
        // а также, нет смысла переключаться, если нет [других] процессов
        if (processes_count === 0)
            return;

        if (cpu.context >= processes_count - 1) {
            cpu.context = 0;
        } else {
            cpu.context++;
        };

        cpu.items = cpu.processes[cpu.context].code;

        console.log("scheduler: " + cpu.name + ": new context - "
                + cpu.processes[cpu.context].name + " (" + cpu.context + ")");
    };
};

function Machine(cycles) {
    this.cycles = cycles;
    this.clock = 1000; // одна секунда

    this.cpu = new CPU();
    this.r1  = new Resource('r1');
    this.r2  = new Resource('r2');
    this.r3  = new Resource('r3');

    this.load_program = function(name, code) {
        code = compile(code);
        this.cpu.new_context(new Process(name, code));
    };

    this.dispatch = function() {
        console.log("-------- cycle " + this.cycles + " --------");

        if (this.cycles != 0)
            setTimeout(function(machine) { machine.dispatch() }, this.clock, this);

        this.cpu.execute();

        this.r1.execute();
        this.r2.execute();
        this.r3.execute();

        this.cycles--;
    };

    // поскольку машина уже работает сразу после dispatch(), необходимо
    // предварительно загрузить в процессор стартовый код - планировщик
    this.bootstrap = function() {
        this.cpu.scheduler.dispatch(this.cpu);
        this.dispatch();
    };

};

//var machine = new Machine(100);
//machine.load_program("ls", "C C C");
//machine.load_program("cat", "C R1:4 C");
//machine.dispatch();
