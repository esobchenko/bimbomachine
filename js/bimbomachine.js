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
    this.instruction = undefined;       // текущая команда
    this.instruction_ticks = 0;         // счетчик тиков для текущей комманды
    this.interrupt_interval = 5;        // период генерации прерывания
    this.interrupt_ticks = 0;           // время до генерации прерывания

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

        this.run_instruction(this.instruction);
        this.instruction_ticks--;

        // команда выполнена
        if (this.instruction_ticks <= 0)
            this.instruction = undefined;
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

    // для связки CPU - Scheduler необходимо решить вопрос
    // "курицы и яйца": ЦП управляется планировщиком, но
    // планировщик работает на ЦП. Поэтому необходимо создать
    // объекты, позволяющие адресоваться к одной сущности в
    // контексте другой, будь то CPU или Scheduler
    this.scheduler.init(this);

    this.interrupt = function() {
        // этим кодом мы эмулируем прерывание, переключающее контекст: то бишь
        // каждые scheduler_dispatch_interval тактов будет выполнятся
        // переключение на планировщик
        console.log(this.name + ": interrupt tick " + this.ticks);

        this.scheduler.dispatch(this);

        this.ticks++;
    };

    this.run_instruction = function(instruction) {
        console.log(this.name + ": executing "
            + instruction.instr + ":" + instruction.ticks
            + " for context " + this.context);
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

    this.init = function(cpu) {
        this.cpu = cpu;
    };

    this.dispatch = function() {
        console.log("scheduler: dispatch");

        var nprocesses = this.cpu.memory.length;

        // нельзя переключать контекст, если команда все еще на процессоре,
        // а также, нет смысла переключаться, если нет [других] процессов
        if (0 === nprocesses)
            return;

        if (this.cpu.context >= nprocesses - 1) {
            this.cpu.context = 0;
        } else {
            this.cpu.context++;
        };

        this.cpu.items = this.cpu.memory[this.cpu.context].code;

        console.log("scheduler: " + this.cpu.name + ": new context - "
                + this.cpu.context
                + " (name '" + this.cpu.memory[this.cpu.context].name
                + "', pid " + this.cpu.memory[this.cpu.context].pid + ")");

        if (0 === this.cpu.queue_size()) {
            this.terminate_process(this.cpu.memory[this.cpu.context].pid);
        }
    };

    this.new_process = function(name, code) {
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
    this.clock = 500; // 1/2 секунды

    this.cpu = new CPU();
    this.r1  = new Resource('r1');
    this.r2  = new Resource('r2');
    this.r3  = new Resource('r3');

    this.load_program = function(name, source) {
        var code = compile(source);
        this.cpu.scheduler.new_process(name, code);
    };

    this.dispatch = function() {
        console.log("-------- tick " + this.ticks + " --------");

        if (this.ticks != 0)
            setTimeout(function(machine) { machine.dispatch() },
                this.clock, this);

        this.cpu.execute();

        this.r1.execute();
        this.r2.execute();
        this.r3.execute();

        this.ticks--;
    };

    // поскольку машина уже работает сразу после dispatch(), необходимо
    // предварительно загрузить в процессор стартовый код - планировщик
    this.bootstrap = function() {
        console.log("machine: boot");
        this.cpu.context = -1;
        this.dispatch();
    };

};

//var machine = new Machine(100);
//machine.load_program("ls", "C C C");
//machine.load_program("cat", "C R1:4 C");
//machine.bootstrap();
