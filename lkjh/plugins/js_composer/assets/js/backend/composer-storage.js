/* =========================================================
 * composer-storage.js 1
 * =========================================================
 * Copyright 2013 Wpbakery
 *
 * Visual composer backbone/underscore Storage hidden field
 * ========================================================= */
(function ($) {
    vc.debug = false;
    /**
     * Shortcodes mapping settings.
     * @type {Object}
     */
    vc.map = _.isUndefined(window.vc_mapper) ? {} : window.vc_mapper;
    /**
     * @constructor
     */
    var Storage = function() {
        this.data = {};
    };
    /**
     * CRUD methods for content management.
     * @type {Object}
     */
    Storage.prototype = {
        url: window.ajaxurl,
        checksum: false,
        locked: false,
        /**
         * Create new object in storage. Require to define model name because system uses only one hidden field with
         * serialized json object.
         * @param model - Backbone.Model object
         * @return {*} - Backbone.Model object
         */
        create: function(model) {
            if (!model.id) model.id = model.attributes.id = vc_guid();
            this.data[model.id] = model.toJSON();
            // optimize root update
            this.setModelRoot(model.id);
            this.save();
            return model;
        },
        /**
         * Optimization methods
         */
        // {{ Methods allows lock/unlock data parsing into shortcodes and saving it in wp editor.
        lock: function() {
            this.locked = true;
        },
        unlock: function() {
            this.locked = false;
        },
        // }}
        setModelRoot: function(id) {
            var data = this.data[id];
            if(_.isString(data.parent_id) && _.isObject(this.data[data.parent_id])) {
                data.root_id = this.data[data.parent_id].root_id;
            }
            if(_.isObject(this.data[data.root_id])) this.data[data.root_id].html = false;
        },
        /**
         * Update object in storage.
         * @param model
         * @return {*}
         */
        update: function(model) {
            this.data[model.id] = model.toJSON();

            this.setModelRoot(model.id);
            this.save();
            return model;
        },
        /**
         * Remove record from storage
         * @param model
         * @return {*}
         */
        destroy: function(model) {
            if(!_.isUndefined(this.data[model.id]) && !_.isUndefined(this.data[model.id].root_id) && _.isObject(this.data[this.data[model.id].root_id])) {
                this.data[this.data[model.id].root_id].html = false;
            }
            if(!_.isUndefined(this.data[model.id])) {
                delete this.data[model.id];
            }
            this.save();
            return model;
        },
        find: function(model_id) {
            return this.data[model_id];
        },
        findAll: function() {
            this.fetch();
            return _.values(this.data);
        },
        /**
         * Find all root models which are sorted by order field.
         * @return {*}
         */
        findAllRootSorted: function() {
            var models = _.filter(_.values(this.data), function(model){
                return model.parent_id === false;
            });
            return _.sortBy(models, function(model){
                return model.order;
            });
        },
        /**
         * Converts model data to wordpress shortcode.
         * @param model
         * @return {*}
         */
        createShortcodeString: function(model){
            var params = model.params,
                params_to_string = {};
            _.each(params, function(value, key){
                if(key!=='content' && !_.isEmpty(value)) params_to_string[key] = value;
            });
            var content = this._getShortcodeContent(model),
                is_container = _.isObject(vc.map[model.shortcode]) && _.isBoolean(vc.map[model.shortcode].is_container) && vc.map[model.shortcode].is_container === true;
            return wp.shortcode.string({
                tag: model.shortcode,
                attrs: params_to_string,
                content: content,
                type: !is_container && _.isEmpty(content) ? 'single' : ''
            });
        },
        save: function() {
            if(this.locked) {
                this.locked = false;
                return false;
            }
            var content =  _.reduce(this.findAllRootSorted(), function(memo, model){
                // if(!_.isString(model.html)) {
                    model.html = this.createShortcodeString(model);
                // }
                return memo + model.html;
            }, '', this);
            this.setContent(content);
            this.checksum = window.md5(content);
        },
        /**
         * If shortcode is container like, gets content of is shortcode in shortcodes style.
         * @param model
         * @return {*}
         * @private
         */
        _getShortcodeContent: function(parent) {
            var that = this,
                models = _.sortBy(_.filter(this.data, function(model) {
                    // Filter children
                    return model.parent_id === parent.id;
                }),function(model){
                    // Sort by `order` field
                    return model.order;
                }),

                params = parent.params;

            if(!models.length) return _.isUndefined(params.content) ? '' : params.content;
            return _.reduce(models, function(memo, model){
                return memo + that.createShortcodeString(model);
            }, '');
        },
        /**
         * Get content of main editor of current post. Data is used as models collection of shortcodes.
         * @return {*}
         */
        getContent:function () {
            var content;
            if(_.isObject(window.tinymce) && tinymce.editors.content) {
                // window.switchEditors.go('content', 'html');
                tinymce.editors.content.save();
                // if(window.tinyMCE.settings.apply_source_formatting!= undefined && window.tinyMCE.settings.apply_source_formatting === true) {
                // content = window.switchEditors._wp_Nop(content);
                // }
            }
            content = typeof(window.switchEditors)!=='undefined' ?  window.switchEditors._wp_Nop($('#content').val()) : $('#content').val();
            return content;
        },
        /**
         * Set content of the current_post inside editor.
         * @param content
         * @private
         */
        setContent: function(content) {
            if(_.isObject(window.tinymce) && tinymce.editors.content) {
                tinymce.editors.content.setContent(content);
                tinymce.editors.content.save();
            }
            $('#content').val(content);
        },
        parseContent: function(data, content, parent) {
            var tags = _.keys(vc.map).join('|'),
                reg = window.wp.shortcode.regexp(tags),
                matches = content.trim().match(reg);
            if(_.isNull(matches)) return data;
            _.each(matches, function(raw) {
                var sub_matches = raw.match(this.regexp(tags)),
                    sub_content = sub_matches[5],
                    sub_regexp = new RegExp('^[\\s]*\\[\\[?(' + _.keys(vc.map).join('|') + ')(?![\\w-])'),
                    id = window.vc_guid(),
                    atts = window.wp.shortcode.attrs(sub_matches[3]),
                    shortcodes,
                    shortcode = {
                        id: id,
                        shortcode: sub_matches[2],
                        order: this.order,
                        params: _.extend({}, atts.named),
                        parent_id: (_.isObject(parent)  ? parent.id : false),
                        root_id: (_.isObject(parent)  ? parent.root_id : id)
                    };
                this.order +=1;
                data[id] = shortcode;
                if(id == shortcode.root_id) {
                    data[id].html = raw;
                }
                if(_.isString(sub_content) && sub_content.match(sub_regexp)) {
                    data = this.parseContent(data, sub_content, data[id]);
                } else if(_.isString(sub_content)) {
                    data[id].params.content = sub_content.match(/\n/) ? window.switchEditors.wpautop(sub_content) : sub_content;
                }
            }, this);
            return data;
        },
        isContentChanged: function() {
            return this.checksum===false || this.checksum!==window.md5(this.getContent());
        },
        wrapData: function(content) {
            var tags =_.keys(vc.map).join('|'),
                reg = this.regexp_split('vc_row'),
                starts_with_shortcode  = new RegExp('^\\[(\\[?)\s*'+ tags, 'g');
                matches = _.filter(content.trim().split(reg), function(value) {if(!_.isEmpty(value)) return value;});
            content = _.reduce(matches, function(mem, value){
                if(!value.trim().match(starts_with_shortcode)) {
                    value = '[vc_row][vc_column][vc_column_text]' + value + '[/vc_column_text][/vc_column][/vc_row]';
                }
                return mem + value;
            }, '');
            return content;
        },
        fetch: function(content) {
            if(!this.isContentChanged()) return this;
            this.order = 0;
                if(_.isUndefined(content)) var content = this.getContent();
                this.checksum = window.md5(content);
                content = this.wrapData(content);
                this.data = this.parseContent({}, content);
            try {

            } catch(e) {
                this.data = {};
            }
        },
        append: function(content) {
            this.data = {};
            this.order = 0;
            try {
                var current_content = this.getContent();
                this.setContent(current_content + '' + content);
            } catch(e) {
            }
        },
        regexp_split: _.memoize(function(tags) {
            return new RegExp( '(\\[(\\[?)[' + tags + ']+' +
                '(?![\\w-])' +
                '[^\\]\\/]*' +
                    '[\\/' +
                        '(?!\\])' +
                        '[^\\]\\/]*' +
                    ']?' +
                '(?:' +
                    '\\/]' +
                    '\\]|\\]' +
                    '(?:' +
                        '[^\\[]*' +
                            '(?:\\[' +
                                '(?!\\/' + tags + '\\])[^\\[]*' +
                            ')*' +
                        '' +
                        '\\[\\/' + tags + '\\]' +
                    ')?' +
                ')' +
                '\\]?)', 'g');
        }),
        regexp: _.memoize(function(tags) {
            return new RegExp( '\\[(\\[?)(' + tags + ')(?![\\w-])([^\\]\\/]*(?:\\/(?!\\])[^\\]\\/]*)*?)(?:(\\/)\\]|\\](?:([^\\[]*(?:\\[(?!\\/\\2\\])[^\\[]*)*)(\\[\\/\\2\\]))?)(\\]?)');

        })
    };
    vc.storage = new Storage;

    vc.test = {
        a:_.memoize(function(a){
            return a;
        })
    }
})(window.jQuery);